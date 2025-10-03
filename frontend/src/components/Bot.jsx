import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mic, Square, Volume2, VolumeX } from "lucide-react";
import { GoogleGenerativeAI } from '@google/generative-ai';
import NavBar from "./NavBar";

// import dotenv from 'dotenv';
// dotenv.config();

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

const Bot = () => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const textareaRef = useRef(null);
  const [isScrollable, setIsScrollable] = useState(false);
  const messagesEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const synthRef = useRef(window.speechSynthesis);
  const navigate = useNavigate();

  useEffect(() => {
    fetchChatHistory();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchChatHistory = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'}/chat/`, {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          navigate("/login");
          return;
        }
        throw new Error(`Failed to fetch chat history: ${response.status}`);
      }

      const data = await response.json();

      if (data.chat_history && Array.isArray(data.chat_history)) {
        const processedMessages = data.chat_history.flatMap((msg, index) => {
          const messages = [];
          if (msg.user) {
            messages.push({
              id: `user-${index}-${Date.now()}`,
              type: "user",
              content: msg.user,
              timestamp: new Date(),
            });
          }
          if (msg.bot) {
            messages.push({
              id: `bot-${index}-${Date.now()}`,
              type: "bot",
              content: msg.bot,
              timestamp: new Date(),
            });
          }
          return messages;
        });
        setMessages(processedMessages);
      }
    } catch (err) {
      console.error("Fetch error:", err);
      setError(err.message || "Failed to load chat history");
    } finally {
      setLoading(false);
    }
  };

  const handleInput = (e) => {
    setMessage(e.target.value);
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const newHeight = textarea.scrollHeight;

    if (newHeight <= 160) {
      textarea.style.height = `${newHeight}px`;
      setIsScrollable(false);
    } else {
      textarea.style.height = "160px";
      setIsScrollable(true);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      chunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        await processVoiceInput(audioBlob);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Error accessing microphone:", error);
      setError("Error accessing microphone. Please ensure microphone permissions are granted.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
  };

  const processVoiceInput = async (audioBlob) => {
    try {
      // Convert the audio blob to base64
      const audioBase64 = await audioBlobToBase64(audioBlob);
  
      // Send the audio to Google Gemini for transcription
      const result = await model.generateContent([
        { text: "Transcribe this WebM audio file:" },
        { inlineData: { mimeType: "audio/webm", data: audioBase64 } },
      ]);
  
      // Extract the transcription from the response
      const textResponse = await result.response.text();
      if (textResponse) {
        setMessage(textResponse); // Set the transcribed text in the input box
        await handleSendMessage(textResponse); // Send the transcribed text as a message
      }
    } catch (error) {
      console.error("Error processing voice input with Gemini:", error);
      setError("Failed to process voice input with Gemini.");
    }
  };
  
  // Helper function to convert audio blob to base64
  const audioBlobToBase64 = (blob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result?.toString().split(",")[1];
        resolve(base64data || "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const speakResponse = (text) => {
    if (synthRef.current) {
      synthRef.current.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      synthRef.current.speak(utterance);
    }
  };

  const stopSpeaking = () => {
    if (synthRef.current) {
      synthRef.current.cancel();
      setIsSpeaking(false);
    }
  };


  const handleSendMessage = async (voiceText = null) => {
    const messageToSend = voiceText || message;
    if (!messageToSend.trim() || isSending) return;

    setIsSending(true);
    setError(null);

    const tempId = Date.now();
    const userMessage = {
      id: `user-${tempId}`,
      type: "user",
      content: messageToSend,
      timestamp: new Date(),
    };

    try {
      setMessages((prev) => [...prev, userMessage]);

      const response = await fetch(`${import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'}/chat/`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          text: messageToSend
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.status}`);
      }

      const data = await response.json();

      const botResponse = {
        id: `bot-${tempId}`,
        type: "bot",
        content: data.response || "No response received",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, botResponse]);

      if (data.response) {
        speakResponse(data.response);
      }

      setMessage("");
    } catch (err) {
      console.error("Error sending message:", err);
      setError(err.message || "Failed to send message");
      setMessages((prev) => prev.filter((msg) => msg.id !== `user-${tempId}`));
    } finally {
      setIsSending(false);
    }
  };


  const formatTimestamp = (date) => {
    if (!date) return "";
    if (!(date instanceof Date)) {
      date = new Date(date);
    }
    if (isNaN(date.getTime())) return "";

    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };


  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[90vh] bg-gradient-to-br from-blue-100 to-purple-200 dark:bg-gradient-to-br dark:from-gray-800 dark:to-gray-950">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-8 h-8 bg-blue-500 rounded-full mb-2"></div>
          <div className="text-gray-700 dark:text-gray-300">Loading your chat history...</div>
        </div>
      </div>
    );
  }

  return (
    <>
    <NavBar />
      <div className="flex flex-col items-center min-h-[90vh] bg-gradient-to-br from-blue-100 to-purple-200 dark:bg-gradient-to-br dark:from-gray-800 dark:to-gray-950 pb-20">
        <div className="bg-gradient-to-r from-yellow-600 via-pink-600 to-blue-600 dark:bg-gradient-to-r dark:from-yellow-500 dark:via-pink-500 dark:to-blue-500 bg-clip-text text-transparent font-semibold text-2xl text-center mt-3 mb-2">
          Mental Health Assistant
        </div>

        {error && !error.includes("404") && (
          <div className="text-red-600 dark:text-red-400 p-3 mb-4 bg-white/80 dark:bg-gray-800/80 rounded-lg max-w-3xl w-full text-center">
            {error}
          </div>
        )}


        <div className="flex flex-col gap-4 w-[90%] md:w-[800px] h-[70vh] overflow-y-auto mb-4">
          {messages.length > 0 ? (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[90%] rounded-2xl px-4 py-3 break-words ${
                  msg.type === "user"
                    ? "self-end bg-gradient-to-br from-blue-500 to-green-500 text-white rounded-tr-none"
                    : "self-start bg-gradient-to-br from-sky-200 to-indigo-100 dark:from-gray-700 dark:to-gray-600 text-gray-800 dark:text-gray-100 rounded-tl-none"
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs">{msg.type === "user" ? "You" : "Assistant"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {msg.type === "bot" && (
                      isSpeaking ? (
                        <button
                          onClick={stopSpeaking}
                          className="text-gray-600 dark:text-gray-300 hover:text-red-500 p-1"
                        >
                          <VolumeX className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => speakResponse(msg.content)}
                          className="text-gray-600 dark:text-gray-300 hover:text-blue-500 p-1"
                        >
                          <Volume2 className="h-4 w-4" />
                        </button>
                      )
                    )}
                    <span className="text-xs opacity-70">{formatTimestamp(msg.timestamp)}</span>
                  </div>
                </div>
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            ))
          ) : (
            <div className="text-center text-gray-600 dark:text-gray-400 p-4 bg-white/50 dark:bg-gray-800/50 rounded-lg">
              No conversations found. Start a conversation below!
            </div>
          )}
          <div ref={messagesEndRef} className="mb-8" />
        </div>

        <div className="fixed bottom-8 w-[90%] md:w-[800px] px-4">
          <div className={`${isTyping ? "bg-gradient-to-tr from-blue-500 to-purple-500" : ""} p-[2px] rounded-2xl`}>
            <div className="bg-sky-100 dark:bg-gray-900 rounded-2xl">
              <div className="flex items-center gap-2 px-3 py-2">
                {isRecording ? (
                  <button
                    onClick={stopRecording}
                    className="text-red-500 hover:text-red-600 p-2 rounded-full transition-colors"
                  >
                    <Square className="h-5 w-5" />
                  </button>
                ) : (
                  <button
                    onClick={startRecording}
                    className="text-blue-500 hover:text-blue-600 p-2 rounded-full transition-colors"
                  >
                    <Mic className="h-5 w-5" />
                  </button>
                )}
                <textarea
                  ref={textareaRef}
                  className={`bg-transparent text-gray-800 dark:text-gray-300 focus:outline-0 focus:border-0 p-3 pb-10 transition-all resize-none max-h-40 w-full font-semibold dark:font-normal ${
                    isScrollable ? "overflow-y-auto" : "overflow-hidden"
                  }`}
                  placeholder="Share how you're feeling today..."
                  value={message}
                  style={{ height: "auto", minHeight: "60px" }}
                  onChange={handleInput}
                  onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                />
                <button
                  onClick={() => handleSendMessage()}
                  disabled={isSending || !message.trim()}
                  className="text-gray-200 bg-gradient-to-br from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 h-8 w-8 rounded-full flex items-center justify-center disabled:opacity-50"
                >
                  {isSending ? (
                    <svg
                      className="animate-spin h-4 w-4 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                  ) : (
                    <svg width={22} height={22}>
                      <use xlinkHref="/icons.svg#up-arrow-icon" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Bot;