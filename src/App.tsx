// src/App.tsx
import { useRef, useState, useEffect } from "react";
import {
  Box,
  Button,
  Text,
  VStack,
  Heading,
  HStack,
  Divider,
  useToast,
} from "@chakra-ui/react";
import { io, Socket } from "socket.io-client";
// @ts-ignore
import RecordRTC from "recordrtc";

interface TranscriptSegment {
  text: string;
  speakerId?: string;
}

const socketURL = "http://localhost:8000";

function App() {
  const [recording, setRecording] = useState(false);
  // Generate a random room ID once at mount
  const [room] = useState<string>(() =>
    Math.random().toString(36).substring(2, 10)
  );
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);
  const [chapterTitles, setChapterTitles] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const toast = useToast();

  const socketRef = useRef<Socket | null>(null);
  const recordRTCRef = useRef<any>(null);

  // 1) Establish the Socket.IO connection and hook up event handlers
  useEffect(() => {
    const socket = io(socketURL, {
      query: { room },
      transports: ["websocket"],
      reconnectionAttempts: 3,
    });

    socket.on("join_room", (data) => {
      console.log("Joined room:", data.room);
    });

    // Whenever the backend emits a partial transcribing result
    socket.on("partial_result", (data) => {
      setTranscripts((prev) => [
        ...prev,
        { text: data.text, speakerId: data.speakerId || "?" },
      ]);
    });

    // Whenever the backend emits a finalized transcription
    socket.on("final_result", (data) => {
      setTranscripts((prev) => [
        ...prev,
        { text: data.text, speakerId: data.speakerId || "?" },
      ]);
    });

    // For file-based transcriptions (if you ever use it):
    socket.on("transcribe_partial", (data) => {
      setTranscripts((prev) => [
        ...prev,
        { text: data.text, speakerId: data.speakerId || "?" },
      ]);
    });

    socket.on("transcribe_final", (data) => {
      setTranscripts((prev) => [
        ...prev,
        { text: data.transcript || data.text, speakerId: data.speakerId || "?" },
      ]);
    });

    socket.on("transcription_progress", (data) => {
      setProgress(data.progress);
    });

    socket.on("chapter_titles", (data) => {
      setChapterTitles(data.titles);
      toast({ title: "Chapter Titles Generated", status: "info", duration: 3000 });
    });

    socketRef.current = socket;
    return () => {
      socket.disconnect();
    };
  }, [room, toast]);

  // 2) Call this before you start sending audio blobs.
  const initTranscription = async () => {
    try {
      const resp = await fetch("http://localhost:8000/start_transcription_ct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room }),
      });
      const json = await resp.json();
      console.log("start_transcription_ct response:", json);
    } catch (err) {
      console.error("Error calling /start_transcription_ct:", err);
    }
  };

  // 3) Start capturing microphone and streaming to backend
  const startRecording = async () => {
    // Reset UI state
    setTranscripts([]);
    setProgress(0);
    setChapterTitles("");
    setRecording(true);

    // Tell backend to spin up its ConversationTranscriber before we begin sending audio
    await initTranscription();

    // Now grab the mic stream and begin sending raw PCM via Socket.IO
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordRTCRef.current = new RecordRTC(stream, {
      type: "audio",
      mimeType: "audio/wav",
      desiredSampRate: 16000,
      recorderType: RecordRTC.StereoAudioRecorder,
      numberOfAudioChannels: 1,
      timeSlice: 1000, // send data every 1 second
      ondataavailable: (blob: Blob) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const arrayBuffer = reader.result as ArrayBuffer;
          socketRef.current?.emit("audio_data", {
            room,
            audio: new Uint8Array(arrayBuffer),
          });
        };
        reader.readAsArrayBuffer(blob);
      },
    });
    recordRTCRef.current.startRecording();
  };

  // 4) Stop sending audio, then tell backend to shut down the transcriber
  const stopRecording = async () => {
    setRecording(false);

    // First, stop the backend transcription session
    try {
      const resp = await fetch("http://localhost:8000/stop_transcription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room }),
      });
      const json = await resp.json();
      console.log("stop_transcription response:", json);
    } catch (err) {
      console.error("Error calling /stop_transcription:", err);
    }

    // Then stop capturing mic audio
    if (recordRTCRef.current) {
      recordRTCRef.current.stopRecording(() => {
        // We do not disconnect Socket.IO *immediately* here if you want to receive any final events.
        // But you could: socketRef.current?.disconnect();
      });
    }
  };

  return (
    <Box p={6} maxW="2xl" mx="auto">
      <VStack spacing={6} align="stretch">
        <Heading size="lg">🗣️ Azure AI Voice Assistant</Heading>

        <HStack>
          <Button colorScheme="teal" onClick={startRecording} isDisabled={recording}>
            Start Listening
          </Button>
          <Button colorScheme="red" onClick={stopRecording} isDisabled={!recording}>
            Stop Listening
          </Button>
        </HStack>

        <Divider />

        <Box>
          <Text fontWeight="bold" mb={2}>
            {recording ? "Listening..." : "Not Recording"}
          </Text>
          <Text>Progress: {progress.toFixed(1)}%</Text>
        </Box>

        <Box>
          <Text fontWeight="bold">🗒️ Live Transcription:</Text>
          <VStack align="stretch">
            {transcripts.length === 0 ? (
              <Text color="gray.500">No speech detected yet.</Text>
            ) : (
              transcripts.map((seg, idx) => (
                <Box key={idx} p={2} bg="gray.50" borderRadius="md">
                  <Text fontWeight="bold">Speaker {seg.speakerId ?? "?"}:</Text>
                  <Text>{seg.text}</Text>
                </Box>
              ))
            )}
          </VStack>
        </Box>

        <Box>
          <Text fontWeight="bold" mt={3}>
            📚 Chapter Titles (AI-generated):
          </Text>
          <Text whiteSpace="pre-line">{chapterTitles}</Text>
        </Box>
      </VStack>
    </Box>
  );
}

export default App;
