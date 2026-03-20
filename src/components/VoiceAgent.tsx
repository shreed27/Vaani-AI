import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LiveServerMessage, Modality } from "@google/genai";
import { createLiveSession, getTransactions, getSummary, verifyPayment, queryTransactions, checkDispute, categorizeTransaction, getTopCategory } from "../services/gemini";
import { Mic, MicOff, Volume2, VolumeX, Loader2, Play, Pause, FileText, Sparkles, Radio } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { collection, query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, arrayUnion } from "firebase/firestore";
import { db } from "../firebase";
import { Transaction } from "../types";
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../utils/errorHandling';

// LiveKit imports for robust real-time UI
import { 
  LiveKitRoom, 
  VideoConference, 
  ControlBar, 
  useTracks, 
  AudioVisualizer,
  RoomAudioRenderer
} from '@livekit/components-react';
import { Track } from 'livekit-client';

const WORKLET_CODE = `
class AudioInputProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      this.port.postMessage(input[0]);
    }
    return true;
  }
}
registerProcessor('audio-input-processor', AudioInputProcessor);
`;

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

interface VoiceAgentProps {
  userId: string;
  role: 'merchant' | 'customer';
  userName: string;
  autoAnnounce?: boolean;
}

const VoiceAgent: React.FC<VoiceAgentProps> = ({ userId, role, userName, autoAnnounce = false }) => {
  const [isSetup, setIsSetup] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isWakeWordActive, setIsWakeWordActive] = useState(true);
  const [isActuallyListening, setIsActuallyListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);
  const lastProcessedTxId = useRef<string | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioWorkletLoadedRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const isRecognitionRunning = useRef(false);
  const isConnectingRef = useRef(false);
  const isActiveRef = useRef(false);
  const currentConversationId = useRef<string | null>(null);
  const currentTurnText = useRef<{ user: string; ai: string }>({ user: '', ai: '' });

  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  
  useEffect(() => {
    fetch('/api/health')
      .then(r => r.ok ? setBackendStatus('online') : setBackendStatus('offline'))
      .catch(() => setBackendStatus('offline'));
  }, []);

  useEffect(() => {
    isConnectingRef.current = isConnecting;
  }, [isConnecting]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // Wake word detection using Web Speech API
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech Recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false; // Use false and restart on end for better reliability in some browsers
    recognition.interimResults = true;
    recognition.lang = 'en-US'; // Broader compatibility

    recognitionRef.current = recognition;

    recognition.onstart = () => {
      console.log("Wake word detection started (en-US)...");
      isRecognitionRunning.current = true;
      setIsActuallyListening(true);
    };

    recognition.onresult = (event: any) => {
      // Check all results in the event for better sensitivity
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        transcript += event.results[i][0].transcript;
      }
      transcript = transcript.toLowerCase().trim();

      console.log("Vaani Heard (Transcript):", transcript);
      
      // Check for variations of "Vaani"
      const wakeWords = [
        'hey vaani', 'vaani', 'vani', 'wani', 'honey', 'bunny', 'money', 
        'hey vani', 'vaani assistant', 'hey bunny', 'hey honey', 'hey money',
        'hey bonnie', 'hey barney', 'hey funny', 'hey sunny', 'hey vanya',
        'hey barney', 'hey vana', 'hey vanna', 'hey vinnie', 'hey benny',
        'hey vanni', 'hey vanny', 'hey vonee', 'hey vonie', 'hey vonnie'
      ];
      const detected = wakeWords.some(word => transcript.includes(word));

      if (detected) {
        console.log("Wake word MATCHED:", transcript);
        if (!isActiveRef.current && !isConnectingRef.current) {
          console.log("Wake word detected! Activating Vaani...");
          if (!isSetup) {
            console.log("Calling handleInitialSetup...");
            handleInitialSetup();
          } else {
            console.log("Calling startSession...");
            startSession();
          }
        } else {
          console.log("Wake word detected but session already active or connecting.", { isActive: isActiveRef.current, isConnecting: isConnectingRef.current });
        }
      }
    };

    recognition.onnomatch = () => {
      console.log("Speech heard but no match.");
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'aborted') {
        console.warn("Speech Recognition aborted (expected during session start)");
        isRecognitionRunning.current = false;
        setIsActuallyListening(false);
        return;
      }
      if (event.error === 'not-allowed') {
        console.warn("Speech Recognition permission denied.");
        setIsWakeWordActive(false);
        setIsActuallyListening(false);
        return;
      }
      console.error("Speech Recognition Error:", event.error);
      isRecognitionRunning.current = false;
      setIsActuallyListening(false);
    };

    recognition.onend = () => {
      isRecognitionRunning.current = false;
      setIsActuallyListening(false);
      // ONLY restart if we are NOT active AND NOT connecting
      if (isWakeWordActive && !isActiveRef.current && !isConnectingRef.current) {
        // Use a small delay to avoid rapid restart cycles
        setTimeout(() => {
          if (isWakeWordActive && !isActiveRef.current && !isConnectingRef.current && !isRecognitionRunning.current) {
            try { recognition.start(); } catch (e) {
              console.warn("Failed to restart recognition:", e);
            }
          }
        }, 500);
      }
    };

    if (isWakeWordActive && !isActiveRef.current && !isConnectingRef.current && !isRecognitionRunning.current) {
      try { 
        recognition.start(); 
      } catch (e) {
        console.warn("Failed to start recognition:", e);
      }
    }

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.stop();
      }
    };
  }, [isWakeWordActive, isSetup]);

  const updateVolume = useCallback(() => {
    if (!analyserRef.current || !isActive) return;
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    setVolume(average / 128); // Normalized 0-1
    animationFrameRef.current = requestAnimationFrame(updateVolume);
  }, [isActive]);

  useEffect(() => {
    if (isActive) {
      animationFrameRef.current = requestAnimationFrame(updateVolume);
    } else {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      setVolume(0);
    }
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isActive, updateVolume]);

  const speakText = useCallback(async (text: string) => {
    try {
      console.log("Auto-Announcing:", text);
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const apiKey = (process.env as any).API_KEY || process.env.GEMINI_API_KEY;
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } }
          }
        })
      });
      const data = await response.json();
      const base64Audio = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const pcmData = new Int16Array(bytes.buffer);
        audioQueueRef.current.push(pcmData);
        if (!isPlayingRef.current) playNextChunk();
      }
    } catch (err) {
      console.error("TTS Error:", err);
    }
  }, []);

  // Auto-announcement listener
  useEffect(() => {
    if (role !== 'merchant' || !autoAnnounce) return;

    const q = query(
      collection(db, 'transactions'),
      where('merchantId', '==', userId),
      where('status', '==', 'success'),
      orderBy('timestamp', 'desc'),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) return;
      const tx = snapshot.docs[0].data() as Transaction;
      const txId = snapshot.docs[0].id;

      if (lastProcessedTxId.current === null) {
        lastProcessedTxId.current = txId;
        return;
      }

      if (lastProcessedTxId.current !== txId) {
        lastProcessedTxId.current = txId;
        const announcement = `₹${tx.amount} received from ${tx.customerName}`;
        speakText(announcement);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transactions');
    });

    return () => unsubscribe();
  }, [role, autoAnnounce, userId, speakText]);

  const generatePDFReport = async (period: string) => {
    const txs = await getTransactions(userId, role, period === 'today' ? 1 : 2);
    const doc = new jsPDF() as any;
    
    doc.setFontSize(20);
    doc.text(`Daily Transaction Report - ${period.toUpperCase()}`, 14, 22);
    doc.setFontSize(12);
    doc.text(`Merchant: ${userName}`, 14, 32);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 14, 40);

    const tableData = txs.map(tx => [
      new Date(tx.timestamp).toLocaleTimeString(),
      tx.customerName,
      `INR ${tx.amount}`,
      tx.status,
      tx.referenceId
    ]);

    autoTable(doc, {
      startY: 50,
      head: [['Time', 'Customer', 'Amount', 'Status', 'Ref ID']],
      body: tableData,
    });

    const total = txs.reduce((sum, t) => sum + (t.status === 'success' ? t.amount : 0), 0);
    doc.text(`Total Successful Earnings: INR ${total}`, 14, (doc as any).lastAutoTable.finalY + 10);

    doc.save(`Vaani_Report_${new Date().toISOString().split('T')[0]}.pdf`);
    return { success: true, message: "PDF report generated and downloaded." };
  };

  const handleToolCall = useCallback(async (toolCall: any) => {
    const { name, args, id } = toolCall;
    console.log(`Tool Call: ${name}`, args);
    
    // Notify the backend of the tool call (simulating backend-driven AI)
    try {
      await fetch('/api/ai/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, args, userId, role })
      });
    } catch (e) {
      console.warn("Backend notification failed, proceeding locally.");
    }
    
    let result;
    try {
      switch (name) {
        case 'getTransactions':
          result = await getTransactions(userId, role, args.days || 1);
          break;
        case 'getSummary':
          result = await getSummary(userId, role, args.period || 'today');
          break;
        case 'verifyPayment':
          result = await verifyPayment(userId, args.amount, args.timeWindowMinutes || 10);
          break;
        case 'queryTransactions':
          result = await queryTransactions(userId, role, args);
          break;
        case 'checkDispute':
          result = await checkDispute(userId, args.amount, args.referenceId);
          break;
        case 'generateReport':
          result = await generatePDFReport(args.period || 'today');
          break;
        case 'categorizeTransaction':
          result = await categorizeTransaction(args.transactionId, args.category);
          break;
        case 'getTopCategory':
          result = await getTopCategory(userId, role, args.period || 'month');
          break;
        default:
          result = { error: "Unknown tool" };
      }
    } catch (err) {
      console.error("Tool execution error:", err);
      result = { error: "Failed to fetch data" };
    }

    if (sessionRef.current) {
      sessionRef.current.sendToolResponse({
        functionResponses: [{ name, response: { result }, id }]
      });
    }
  }, [userId, role, userName]);

  const stopSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
    }
    setIsActive(false);
    setIsListening(false);
    setIsSpeaking(false);
    setVolume(0);

    // Restart wake word detection after a small delay
    setTimeout(() => {
      if (recognitionRef.current && isWakeWordActive && !isRecognitionRunning.current) {
        try { recognitionRef.current.start(); } catch (e) {}
      }
    }, 1000);
  }, [isWakeWordActive]);

  const playNextChunk = useCallback(async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      return;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    }
    
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    isPlayingRef.current = true;
    setIsSpeaking(true);
    const chunk = audioQueueRef.current.shift()!;
    
    const float32Data = new Float32Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
      float32Data[i] = chunk[i] / 32768.0;
    }

    const buffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000);
    buffer.getChannelData(0).set(float32Data);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.onended = () => {
      playNextChunk();
    };
    source.start();
  }, []);

  const handleInitialSetup = async () => {
    console.log("Starting Vaani Initial Setup...");
    try {
      setIsConnecting(true);
      setError(null);
      
      // Check for secure context
      if (!window.isSecureContext) {
        throw new Error("Vaani requires a secure context (HTTPS) to access the microphone. Please check your connection.");
      }

      // Check if mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microphone access is not supported in this browser or context.");
      }

      // 1. Request mic permission immediately via a user gesture
      console.log("Requesting microphone permission...");
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Microphone permission request timed out. Please ensure you allow access in the browser prompt.")), 15000))
      ]) as MediaStream;
      
      console.log("Microphone permission granted.");
      stream.getTracks().forEach(track => track.stop()); // Release it for now

      // 2. Initialize AudioContext
      console.log("Initializing AudioContext...");
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      
      if (audioContextRef.current.state === 'suspended') {
        console.log("Resuming AudioContext...");
        await audioContextRef.current.resume();
      }

      console.log("Setup complete.");
      setIsSetup(true);
      setIsConnecting(false);
      // Auto-start session after successful activation
      startSession();
    } catch (err) {
      console.error("Setup failed:", err);
      const message = err instanceof Error ? err.message : "Microphone access is required for Vaani to work autonomously.";
      setError(message);
      setIsConnecting(false);
    }
  };

  const logTurn = useCallback(async (speaker: 'user' | 'ai', text: string) => {
    if (!currentConversationId.current) return;
    try {
      const convRef = doc(db, 'conversations', currentConversationId.current);
      await updateDoc(convRef, {
        turns: arrayUnion({
          speaker,
          text,
          timestamp: new Date().toISOString()
        })
      });
    } catch (err) {
      console.error("Failed to log turn:", err);
    }
  }, []);

  const startSession = async () => {
    try {
      // Check for API key selection if needed for preview models
      // We only prompt if we don't have an API key in the environment
      const hasEnvKey = !!((process.env as any).API_KEY || process.env.GEMINI_API_KEY);
      
      if (!hasEnvKey && window.aistudio && !(await window.aistudio.hasSelectedApiKey())) {
        console.log("No API key found, opening selection dialog...");
        await window.aistudio.openSelectKey();
        // After opening, we proceed and hope the user selects one
      }

      setIsConnecting(true);
      setError(null);

      // Create a new conversation log in Firestore
      try {
        const convRef = await addDoc(collection(db, 'conversations'), {
          userId,
          role,
          timestamp: serverTimestamp(),
          turns: []
        });
        currentConversationId.current = convRef.id;
        console.log("Started conversation log:", convRef.id);
      } catch (err) {
        console.error("Failed to create conversation log:", err);
      }

      // Stop wake word recognition while session is active to avoid conflicts
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      // Load AudioWorklet only once
      if (!audioWorkletLoadedRef.current) {
        const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        await audioContextRef.current.audioWorklet.addModule(url);
        audioWorkletLoadedRef.current = true;
        URL.revokeObjectURL(url);
      }

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      streamRef.current = stream;

      const sessionPromise = createLiveSession(userId, role, {
        onopen: () => {
          console.log("Vaani Live Session Opened!");
          setIsConnecting(false);
          setIsActive(true);
          setIsListening(true);
          
          sessionPromise.then((session: any) => {
            sessionRef.current = session;
            // Trigger an initial greeting from Vaani
            session.sendRealtimeInput({ text: "Hello Vaani, I am here. Please greet me." });
            
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const analyser = audioContextRef.current!.createAnalyser();
            analyser.fftSize = 256;
            analyserRef.current = analyser;
            source.connect(analyser);

            const workletNode = new AudioWorkletNode(audioContextRef.current!, 'audio-input-processor');
            workletNodeRef.current = workletNode;

            workletNode.port.onmessage = (e) => {
              const inputData = e.data;
              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
              }
              
              // Efficient base64 conversion
              const uint8Array = new Uint8Array(pcmData.buffer);
              let binary = '';
              const len = uint8Array.byteLength;
              for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(uint8Array[i]);
              }
              const base64Data = btoa(binary);

              if (sessionRef.current) {
                sessionRef.current.sendRealtimeInput({
                  audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                });
              }
            };

            source.connect(workletNode);
          });
        },
        onmessage: async (message: LiveServerMessage) => {
          console.log("Vaani received message:", message);

          if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.inlineData?.data) {
                try {
                  const binaryString = atob(part.inlineData.data);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  
                  // Ensure alignment for Int16Array (must be multiple of 2 bytes)
                  const alignedLength = Math.floor(bytes.byteLength / 2) * 2;
                  const pcmData = new Int16Array(bytes.buffer, 0, alignedLength / 2);
                  
                  audioQueueRef.current.push(pcmData);
                  if (!isPlayingRef.current) playNextChunk();
                } catch (e) {
                  console.error("Failed to decode audio chunk:", e);
                }
              }
              if (part.text) {
                console.log("AI said (text):", part.text);
                logTurn('ai', part.text);
              }
            }
          }

          // Log User Input Transcription
          if (message.serverContent?.interrupted) {
            console.log("AI Interrupted by user");
            audioQueueRef.current = [];
            isPlayingRef.current = false;
            setIsSpeaking(false);
          }

          // Handle Transcriptions
          const userTranscription = (message as any).serverContent?.userTurn?.parts?.[0]?.text;
          if (userTranscription) {
            console.log("User said (transcribed):", userTranscription);
            logTurn('user', userTranscription);
          }

          const aiTranscription = (message as any).serverContent?.modelTurn?.parts?.[0]?.text;
          if (aiTranscription) {
            console.log("AI said (transcribed):", aiTranscription);
            logTurn('ai', aiTranscription);
          }

          if (message.toolCall) {
            for (const call of message.toolCall.functionCalls) {
              await handleToolCall(call);
            }
          }

          if (message.serverContent?.interrupted) {
            console.log("AI Interrupted by user");
            audioQueueRef.current = [];
            isPlayingRef.current = false;
            setIsSpeaking(false);
          }
        },
        onerror: (err: any) => {
          console.error("Live API Error:", err);
          setError("Connection lost. Reconnecting...");
          stopSession();
        },
        onclose: () => {
          stopSession();
        }
      });

      const session = await sessionPromise;
      sessionRef.current = session;
    } catch (err) {
      console.error("Failed to start session:", err);
      setError("Microphone access denied or connection failed.");
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    return () => stopSession();
  }, [stopSession]);

  return (
    <div className="flex flex-col items-center justify-center w-full min-h-[400px] py-12">
      <div className="relative flex flex-col items-center">
        {/* Ambient Glows */}
        <AnimatePresence>
          {(isActive || isConnecting || !isSetup || isWakeWordActive) && (
            <>
              <motion.div
                animate={{ 
                  scale: isActive ? 1.2 + volume * 0.6 : (isWakeWordActive && !isActive ? 1.15 : 1.1),
                  opacity: isActive ? 0.2 + volume * 0.3 : (isWakeWordActive && !isActive ? 0.15 : 0.1),
                  rotate: 360
                }}
                transition={{ 
                  scale: { type: "spring", stiffness: 300, damping: 20 },
                  rotate: { repeat: Infinity, duration: 15, ease: "linear" }
                }}
                className="absolute inset-0 rounded-full bg-gradient-to-tr from-blue-500/30 via-purple-500/30 to-pink-500/30 blur-3xl"
              />
              <motion.div
                animate={{ 
                  scale: isActive ? 1.4 + volume * 0.9 : (isWakeWordActive && !isActive ? 1.35 : 1.3),
                  opacity: isActive ? 0.1 + volume * 0.2 : (isWakeWordActive && !isActive ? 0.08 : 0.05),
                  rotate: -360
                }}
                transition={{ 
                  scale: { type: "spring", stiffness: 200, damping: 15 },
                  rotate: { repeat: Infinity, duration: 20, ease: "linear" }
                }}
                className="absolute inset-0 rounded-full bg-gradient-to-bl from-emerald-500/20 via-blue-500/20 to-indigo-500/20 blur-3xl"
              />
            </>
          )}
        </AnimatePresence>

        {/* The Core Orb */}
        <motion.div
          onClick={!isSetup ? handleInitialSetup : (isActive ? stopSession : startSession)}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          animate={{
            scale: isActive ? 1 + volume * 0.15 : 1,
            borderColor: isActive 
              ? (isSpeaking ? 'rgba(168, 85, 247, 0.4)' : 'rgba(59, 130, 246, 0.4)') 
              : 'rgba(255, 255, 255, 0.05)',
            boxShadow: isActive 
              ? `0 0 ${60 + volume * 120}px rgba(59, 130, 246, 0.3), inset 0 0 40px rgba(0,0,0,0.5)` 
              : '0 20px 40px rgba(0,0,0,0.2), inset 0 0 20px rgba(255,255,255,0.05)'
          }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className={cn(
            "relative z-10 w-64 h-64 rounded-full flex items-center justify-center overflow-hidden border border-white/10 cursor-pointer transition-all duration-1000",
            isActive 
              ? 'bg-zinc-950' 
              : 'bg-gradient-to-br from-white/10 via-white/5 to-transparent backdrop-blur-2xl'
          )}
        >
          {/* Animated Background Layers for Depth */}
          {!isActive && (
            <div className="absolute inset-0 overflow-hidden rounded-full">
              <motion.div 
                animate={{ 
                  rotate: 360,
                  scale: [1, 1.1, 1]
                }}
                transition={{ 
                  rotate: { repeat: Infinity, duration: 20, ease: "linear" },
                  scale: { repeat: Infinity, duration: 8, ease: "easeInOut" }
                }}
                className="absolute -inset-full bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.1)_0%,transparent_70%)]"
              />
              <motion.div 
                animate={{ 
                  rotate: -360,
                  scale: [1.1, 1, 1.1]
                }}
                transition={{ 
                  rotate: { repeat: Infinity, duration: 25, ease: "linear" },
                  scale: { repeat: Infinity, duration: 10, ease: "easeInOut" }
                }}
                className="absolute -inset-full bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.08)_0%,transparent_70%)]"
              />
            </div>
          )}

          {/* Internal Visuals */}
          <AnimatePresence mode="wait">
            {!isSetup ? (
              <motion.div 
                key="setup"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                className="flex flex-col items-center gap-4"
              >
                <div className="relative">
                  <Sparkles className="w-14 h-14 text-white opacity-60" />
                  <motion.div 
                    animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0.6, 0.3] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="absolute inset-0 bg-blue-400/20 blur-xl rounded-full"
                  />
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[11px] font-bold uppercase tracking-[0.4em] text-white/60 drop-shadow-md">Activate</span>
                  <span className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/30 mt-2">or say "Hey Vaani"</span>
                </div>
              </motion.div>
            ) : isActive ? (
              <motion.div 
                key="active"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center"
              >
                {/* Visualizer Bars - More Dynamic */}
                <div className="flex items-end gap-2 h-24 pb-4">
                  {[...Array(9)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{ 
                        height: [20, 20 + volume * (40 + Math.sin(i) * 30), 20],
                        opacity: [0.3, 0.9, 0.3],
                        backgroundColor: isSpeaking 
                          ? ['#a855f7', '#d946ef', '#a855f7'] 
                          : ['#3b82f6', '#60a5fa', '#3b82f6']
                      }}
                      transition={{ 
                        height: { repeat: Infinity, duration: 0.3 + i * 0.04, ease: "easeInOut" },
                        opacity: { repeat: Infinity, duration: 0.5 + i * 0.1 },
                        backgroundColor: { duration: 0.5 }
                      }}
                      className="w-2 rounded-full shadow-[0_0_20px_rgba(59,130,246,0.5)]"
                    />
                  ))}
                </div>
                
                {/* Reactive Glow Overlay */}
                <motion.div 
                  animate={{ 
                    opacity: 0.1 + volume * 0.5,
                    background: isSpeaking 
                      ? 'radial-gradient(circle, rgba(168,85,247,0.15) 0%, transparent 70%)'
                      : 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)'
                  }}
                  className="absolute inset-0" 
                />
              </motion.div>
            ) : (
              <motion.div 
                key="idle"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                className="flex flex-col items-center gap-4"
              >
                <div className="relative">
                  <Mic className={cn(
                    "w-12 h-12 text-white transition-all duration-700", 
                    isActuallyListening ? "opacity-60" : "opacity-10"
                  )} />
                  {isActuallyListening && (
                    <motion.div 
                      animate={{ scale: [1, 1.4, 1], opacity: [0.2, 0.4, 0.2] }}
                      transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                      className="absolute inset-0 bg-white/10 blur-lg rounded-full"
                    />
                  )}
                </div>
                {isActuallyListening && (
                  <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-white/40 drop-shadow-sm">
                    Listening for "Hey Vaani"
                  </span>
                )}
                {!isActuallyListening && isWakeWordActive && !isActive && !isConnecting && (
                  <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-white/20 drop-shadow-sm">
                    Click to enable voice
                  </span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          
          {/* Internal Glass Reflection */}
          <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />
          
          {/* Loading State Overlay */}
          {isConnecting && (
            <div className="absolute inset-0 bg-black/40 backdrop-blur-xl flex items-center justify-center z-20">
              <div className="relative">
                <Loader2 className="w-12 h-12 text-white animate-spin opacity-80" />
                <motion.div 
                  animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full"
                />
              </div>
            </div>
          )}
        </motion.div>

        {/* Minimal Status Text removed for "just an orb" experience */}
      </div>

      {/* Error Message (Floating) */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-12 px-6 py-3 bg-red-500/10 backdrop-blur-xl border border-red-500/20 rounded-2xl flex items-center gap-3 shadow-2xl max-w-sm"
          >
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs text-red-200 font-medium">{error}</span>
            <button onClick={() => setError(null)} className="ml-2 text-red-200/40 hover:text-red-200">
              <MicOff className="w-3 h-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default VoiceAgent;
