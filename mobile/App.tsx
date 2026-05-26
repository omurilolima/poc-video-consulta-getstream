import React, { useCallback, useState } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { LobbyScreen } from "./screens/LobbyScreen";
import { CallScreen } from "./screens/CallScreen";

interface CallParams {
  sessionId: string;
  callId: string;
  callType: string;
  token: string;
  apiKey: string;
  userId: string;
  role: "paciente" | "medico";
}

export default function App() {
  const [callParams, setCallParams] = useState<CallParams | null>(null);
  const exitCall = useCallback(() => setCallParams(null), []);

  return (
    <SafeAreaProvider>
      {callParams ? (
        <CallScreen {...callParams} onLeave={exitCall} />
      ) : (
        <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
          <LobbyScreen onJoin={setCallParams} />
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f8f9fa" },
});
