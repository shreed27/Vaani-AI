import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LiveServerMessage, Modality } from "@google/genai";
import { createLiveSession, getTransactions, getSummary, verifyPayment, queryTransactions, checkDispute } from "../services/gemini";
import { Mic, MicOff, Volume2, VolumeX, Loader2, Play, Pause, FileText, Sparkles, Radio } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { collection, query, where, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { Transaction } from "../types";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
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

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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
    if (!isSetup) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech Recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-IN';

    recognition.onstart = () => {
      isRecognitionRunning.current = true;
    };

    recognition.onresult = (event: any) => {
      // Get the latest result only
      const lastResultIndex = event.results.length - 1;
      const transcript = event.results[lastResultIndex][0].transcript.toLowerCase().trim();

      console.log("Vaani Heard:", transcript);
      
      // Check for variations of "Vaani"
      const wakeWords = ['hey vaani', 'vaani', 'vani', 'wani', 'honey', 'bunny', 'money'];
      const detected = wakeWords.some(word => transcript.includes(word));

      if (detected) {
        if (!isActiveRef.current && !isConnectingRef.current) {
          console.log("Wake word detected! Starting Vaani...");
          startSession();
        }
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'aborted') {
        console.warn("Speech Recognition aborted (expected during session start)");
        isRecognitionRunning.current = false;
        return;
      }
      console.error("Speech Recognition Error:", event.error);
      if (event.error === 'no-speech') {
        isRecognitionRunning.current = false;
      }
    };

    recognition.onend = () => {
      isRecognitionRunning.current = false;
      // ONLY restart if we are NOT active AND NOT connecting
      if (isWakeWordActive && !isActiveRef.current && !isConnectingRef.current) {
        // Use a small delay to avoid rapid restart cycles
        setTimeout(() => {
          if (isWakeWordActive && !isActiveRef.current && !isConnectingRef.current && !isRecognitionRunning.current) {
            try { recognition.start(); } catch (e) {
              console.warn("Failed to restart recognition:", e);
            }
          }
        }, 1000);
      }
    };

    if (isWakeWordActive && !isActiveRef.current && !isConnectingRef.current && !isRecognitionRunning.current) {
      try { recognition.start(); } catch (e) {}
    }

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onend = null; // Prevent restart on unmount
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
    try {
      setIsConnecting(true);
      setError(null);
      
      // 1. Request mic permission immediately via a user gesture
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // Release it for now

      // 2. Initialize AudioContext
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      setIsSetup(true);
      setIsConnecting(false);
    } catch (err) {
      console.error("Setup failed:", err);
      setError("Microphone access is required for Vaani to work autonomously.");
      setIsConnecting(false);
    }
  };

  const startSession = async () => {
    try {
      // Check for API key selection if needed for preview models
      if (window.aistudio && !(await window.aistudio.hasSelectedApiKey())) {
        const confirm = window.confirm("Vaani requires a Gemini API key for real-time voice. Would you like to select one now?");
        if (confirm) {
          await window.aistudio.openSelectKey();
          // After opening, we assume success and proceed
        } else {
          setIsConnecting(false);
          return;
        }
      }

      setIsConnecting(true);
      setError(null);

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

              session.sendRealtimeInput({
                audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
              });
            };

            source.connect(workletNode);
          });
        },
        onmessage: async (message: LiveServerMessage) => {
          console.log("Vaani received message:", message);
          if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.inlineData?.data) {
                const binaryString = atob(part.inlineData.data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                const pcmData = new Int16Array(bytes.buffer);
                audioQueueRef.current.push(pcmData);
                if (!isPlayingRef.current) playNextChunk();
              }
            }
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
    <div className="flex flex-col items-center justify-center w-full max-w-2xl mx-auto py-12">
      {!isSetup ? (
        <div className="flex flex-col items-center space-y-12 text-center max-w-md">
          <div className="relative">
            <div className="absolute -inset-8 bg-blue-500/20 rounded-full blur-3xl animate-pulse"></div>
            <motion.div 
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 20, ease: "linear" }}
              className="relative w-40 h-40 bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 rounded-full flex items-center justify-center shadow-2xl border-4 border-white/20"
            >
              <Sparkles className="w-20 h-20 text-white" />
            </motion.div>
          </div>
          
          <div className="space-y-4">
            <h2 className="text-4xl font-bold text-white tracking-tight">Wake Vaani</h2>
            <p className="text-gray-400 text-lg leading-relaxed">
              Enable autonomous mode to interact hands-free. Just say <span className="text-blue-400 font-semibold">"Hey Vaani"</span> to start.
            </p>
          </div>

          <button
            onClick={handleInitialSetup}
            disabled={isConnecting}
            className={cn(
              "group relative px-10 py-5 bg-white text-black rounded-full font-bold text-xl transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-50 shadow-[0_0_30px_rgba(255,255,255,0.3)]",
              isConnecting && "cursor-not-allowed"
            )}
          >
            {isConnecting ? (
              <span className="flex items-center space-x-3">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span>Initializing...</span>
              </span>
            ) : (
              "Activate Vaani"
            )}
          </button>

          <p className="text-gray-500 text-sm italic">
            Vaani will listen for her name and respond instantly.
          </p>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-widest pt-4">
            <div className={cn("w-1.5 h-1.5 rounded-full", backendStatus === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500')} />
            <span>Backend: {backendStatus}</span>
          </div>
        </div>
      ) : (
        <>
          {/* The Orb */}
          <div className="relative w-64 h-64 mb-12 flex items-center justify-center">
            <AnimatePresence>
              {(isActive || isConnecting) && (
                <>
                  {/* Outer Glows - Reactive to Volume */}
                  <motion.div
                    animate={{ 
                      scale: isActive ? 1 + volume * 0.5 : 1,
                      opacity: isActive ? 0.2 + volume * 0.3 : 0.1,
                      rotate: 360
                    }}
                    transition={{ 
                      scale: { type: "spring", stiffness: 300, damping: 20 },
                      rotate: { repeat: Infinity, duration: 10, ease: "linear" }
                    }}
                    className="absolute inset-0 rounded-full bg-gradient-to-tr from-blue-400 via-purple-400 to-pink-400 blur-3xl"
                  />
                  <motion.div
                    animate={{ 
                      scale: isActive ? 1.2 + volume * 0.8 : 1.1,
                      opacity: isActive ? 0.1 + volume * 0.2 : 0.05,
                      rotate: -360
                    }}
                    transition={{ 
                      scale: { type: "spring", stiffness: 200, damping: 15 },
                      rotate: { repeat: Infinity, duration: 15, ease: "linear" }
                    }}
                    className="absolute inset-0 rounded-full bg-gradient-to-bl from-emerald-400 via-blue-400 to-indigo-400 blur-3xl"
                  />
                </>
              )}
            </AnimatePresence>

            {/* The Core Orb */}
            <motion.div
              onClick={isActive ? stopSession : startSession}
              animate={{
                scale: isActive ? 1 + volume * 0.2 : 1,
                borderColor: isSpeaking ? 'rgba(168, 85, 247, 0.6)' : 'rgba(255, 255, 255, 0.2)'
              }}
              transition={{ type: "spring", stiffness: 400, damping: 10 }}
              className={cn(
                "relative z-10 w-48 h-48 rounded-full shadow-2xl flex items-center justify-center overflow-hidden border-4 cursor-pointer transition-colors duration-500",
                isActive ? 'bg-zinc-900' : 'bg-[#f0f4f9] hover:bg-[#e1e5ea]'
              )}
            >
              {isActive ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  {/* Visualizer Bars */}
                  <div className="flex items-center gap-1 h-12">
                    {[...Array(5)].map((_, i) => (
                      <motion.div
                        key={i}
                        animate={{ 
                          height: isActive ? [12, 12 + volume * (20 + i * 10), 12] : 12 
                        }}
                        transition={{ repeat: Infinity, duration: 0.5 + i * 0.1 }}
                        className="w-1.5 bg-white rounded-full opacity-80 shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                      />
                    ))}
                  </div>
                  
                  {/* Glow Overlay */}
                  <div className="absolute inset-0 opacity-30">
                    <div className="absolute inset-0 bg-gradient-to-tr from-blue-500 via-purple-500 to-pink-500 animate-pulse" />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Mic className="w-16 h-16 text-[#444746] opacity-30" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#444746] opacity-40">Start</span>
                </div>
              )}
              
              {isConnecting && (
                <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-20">
                  <Loader2 className="w-12 h-12 text-white animate-spin" />
                </div>
              )}
            </motion.div>
          </div>

          <div className="w-full max-w-md bg-[#f0f4f9] rounded-[32px] px-6 py-4 border border-transparent focus-within:border-[#d2d7dd] focus-within:bg-white transition-all shadow-sm flex items-center gap-4">
            <div className="flex-1 flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-[#1f1f1f] font-medium">
                  {isActive ? (isSpeaking ? "Vaani is speaking..." : "Listening...") : (isWakeWordActive ? "Waiting for 'Hey Vaani'..." : "Autonomous Mode Off")}
                </span>
                {isActive && <Sparkles className="w-3 h-3 text-purple-500 animate-pulse" />}
                {isWakeWordActive && !isActive && <Radio className="w-3 h-3 text-emerald-500 animate-pulse" />}
              </div>
              <span className="text-xs text-[#444746]">
                {isActive ? "You can interrupt me anytime" : "Say 'Hey Vaani' to start instantly"}
              </span>
              <div className="flex items-center gap-1.5 text-[9px] text-gray-400 uppercase tracking-tighter mt-1">
                <div className={cn("w-1 h-1 rounded-full", backendStatus === 'online' ? 'bg-emerald-500' : 'bg-red-500')} />
                <span>Backend {backendStatus}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsWakeWordActive(!isWakeWordActive)}
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90",
                  isWakeWordActive ? 'bg-emerald-100 text-emerald-600' : 'bg-zinc-100 text-zinc-400'
                )}
                title={isWakeWordActive ? "Wake word active" : "Wake word inactive"}
              >
                <Radio className="w-5 h-5" />
              </button>
              
              <button
                onClick={isActive ? stopSession : startSession}
                disabled={isConnecting}
                className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90",
                  isActive 
                    ? 'bg-zinc-900 text-white hover:bg-zinc-800' 
                    : 'bg-white text-[#444746] hover:bg-[#e1e5ea] shadow-sm',
                  isConnecting && 'opacity-50 cursor-not-allowed'
                )}
              >
                {isConnecting ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : isActive ? (
                  <MicOff className="w-6 h-6" />
                ) : (
                  <Mic className="w-6 h-6" />
                )}
              </button>
            </div>
          </div>

          <button 
            onClick={() => setIsSetup(false)}
            className="mt-8 text-gray-500 hover:text-gray-700 text-xs transition-colors underline underline-offset-4"
          >
            Switch to Manual Mode
          </button>
        </>
      )}

      {error && (
        <motion.div 
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 px-4 py-2 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2"
        >
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <p className="text-xs text-red-600 font-medium">{error}</p>
        </motion.div>
      )}
    </div>
  );
};

export default VoiceAgent;
