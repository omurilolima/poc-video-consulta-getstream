import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, PermissionsAndroid, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  StreamVideo,
  StreamCall,
  CallControls,
  useCallStateHooks,
  StreamVideoClient,
  callManager,
  DebounceType,
  VisibilityState,
} from '@stream-io/video-react-native-sdk';
import { RTCView, type MediaStream } from '@stream-io/react-native-webrtc';
import { api, SessionState } from '../services/api';

const POLL_INTERVAL_MS = 2000;

function hasPublishedTrack(publishedTracks: Array<string | number>, numericTrack: number, textTrack: string) {
  return publishedTracks.some((track) => {
    return track === numericTrack || String(track).toLowerCase().includes(textTrack);
  });
}

interface Props {
  sessionId: string;
  callId: string;
  callType: string;
  token: string;
  apiKey: string;
  userId: string;
  role: 'paciente' | 'medico';
  onLeave(): void;
}

function CallHeader({
  sessionId,
  userId,
  role,
  onLeave,
}: {
  sessionId: string;
  userId: string;
  role: 'paciente' | 'medico';
  onLeave(): void;
}) {
  const { useRemoteParticipants } = useCallStateHooks();
  const remoteParticipants = useRemoteParticipants();
  const mediaReadySentRef = useRef(false);
  const exitedRef = useRef(false);
  const onLeaveRef = useRef(onLeave);
  const lastRemoteUserIdRef = useRef<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('criada');

  onLeaveRef.current = onLeave;

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const session = await api.getSession(sessionId);
        setSessionState((prev) => {
          // C3: ao voltar de ativa → midia_pendente, permitir re-sinalizar media-ready
          if (prev === 'ativa' && session.state === 'midia_pendente') {
            mediaReadySentRef.current = false;
          }
          return session.state;
        });

        if (
          !exitedRef.current &&
          (session.state === 'encerrada' || session.state === 'vetada')
        ) {
          exitedRef.current = true;
          onLeaveRef.current();
        }
      } catch {
        // ignora falha pontual de polling
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [sessionId]);

  useEffect(() => {
    if (remoteParticipants.length === 0) {
      mediaReadySentRef.current = false;
      return;
    }

    const remote = remoteParticipants[0];
    const remoteUserId = remote?.userId;
    if (remoteUserId) lastRemoteUserIdRef.current = remoteUserId;
  }, [remoteParticipants]);

  useEffect(() => {
    if (remoteParticipants.length > 0 || sessionState !== 'ativa') return;
    const remoteUserId = lastRemoteUserIdRef.current;
    if (!remoteUserId) return;

    lastRemoteUserIdRef.current = null;
    mediaReadySentRef.current = false;
    api.notifyLeft(sessionId, remoteUserId).catch(() => undefined);
  }, [remoteParticipants.length, sessionState, sessionId]);

  useEffect(() => {
    if (mediaReadySentRef.current || remoteParticipants.length === 0) return;

    const other = remoteParticipants[0];
    const publishedTracks = other?.publishedTracks ?? [];
    const hasAudio = hasPublishedTrack(publishedTracks, 1, 'audio');
    const hasVideo = hasPublishedTrack(publishedTracks, 2, 'video');

    if (hasAudio && hasVideo) {
      mediaReadySentRef.current = true;
      api.signalMediaReady(sessionId, userId).catch((err) => {
        console.warn('[media-ready] signal failed:', err);
      });
    }
  }, [remoteParticipants, sessionId, userId]);

  async function handleEnd(veto: boolean) {
    try {
      await api.endSession(sessionId, veto);
    } catch (e) {
      Alert.alert('Erro ao encerrar', (e as Error).message);
    }
    if (!exitedRef.current) {
      exitedRef.current = true;
      onLeaveRef.current();
    }
  }

  const insets = useSafeAreaInsets();
  const stateColor = STATE_COLORS[sessionState] ?? '#535862';
  const stateBg = STATE_BG[sessionState] ?? '#F3F4F6';

  return (
    // top: insets.top posiciona o header abaixo da barra de status
    <View style={[styles.headerBar, { top: Math.max(insets.top, 16) }]}>
      <View style={[styles.stateBadge, { backgroundColor: stateBg, borderColor: stateColor + '40' }]}>
        <Text style={[styles.stateText, { color: stateColor }]}>{sessionState}</Text>
      </View>

      <View style={styles.controlsRow}>
        <TouchableOpacity style={styles.btnEnd} onPress={() => handleEnd(false)}>
          <Text style={styles.btnEndText}>Encerrar</Text>
        </TouchableOpacity>

        {role === 'medico' && (
          <TouchableOpacity style={styles.btnVeto} onPress={() => handleEnd(true)}>
            <Text style={styles.btnEndText}>Vetar (C4)</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function CustomStreamCallControls(props: any) {
  const insets = useSafeAreaInsets();
  return (
    // Adiciona um padding inferior seguro + uma margem extra para jogar os botões
    // do Stream (câmera/mic) mais para o meio/cima, fugindo da barra nativa do Android.
    <View style={{ paddingBottom: Math.max(insets.bottom, 40), position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 100 }}>
      <CallControls {...props} />
    </View>
  );
}

function VideoTile({
  stream,
  label,
  mirror = false,
  zOrder = 0,
  debug,
}: {
  stream?: MediaStream;
  label: string;
  mirror?: boolean;
  zOrder?: number;
  debug?: string;
}) {
  const streamUrl = stream?.toURL();

  return (
    <View style={styles.videoTile}>
      {streamUrl ? (
        <RTCView
          key={streamUrl}
          style={StyleSheet.absoluteFill}
          streamURL={streamUrl}
          objectFit="cover"
          mirror={mirror}
          zOrder={zOrder}
        />
      ) : (
        <View style={styles.noVideoTile}>
          <Text style={styles.noVideoText}>{label}</Text>
          {debug ? <Text style={styles.noVideoDebug}>{debug}</Text> : null}
        </View>
      )}
      <Text style={styles.videoLabel}>{label}</Text>
    </View>
  );
}

function CustomCallLayout({
  sessionId,
  userId,
  role,
  call,
  onLeave,
}: {
  sessionId: string;
  userId: string;
  role: 'paciente' | 'medico';
  call: ReturnType<StreamVideoClient['call']>;
  onLeave(): void;
}) {
  const { useCameraState, useLocalParticipant, useRemoteParticipants } = useCallStateHooks();
  const { mediaStream: localCameraStream, direction } = useCameraState();
  const localParticipant = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const remoteParticipant = remoteParticipants[0];
  const remotePublishedTracks = remoteParticipant?.publishedTracks ?? [];
  const remoteTrackKey = remotePublishedTracks.map(String).sort().join(',');

  useEffect(() => {
    if (!remoteParticipant) return;
    if (!hasPublishedTrack(remotePublishedTracks, 2, 'video')) return;

    const currentVisibility = remoteParticipant.viewportVisibilityState?.videoTrack;
    const currentDimension = remoteParticipant.videoDimension;
    const hasSubscription =
      currentVisibility === VisibilityState.VISIBLE &&
      currentDimension?.width === 1280 &&
      currentDimension?.height === 720;

    if (!hasSubscription) {
      call.state.updateParticipant(remoteParticipant.sessionId, {
        viewportVisibilityState: {
          ...(remoteParticipant.viewportVisibilityState ?? {
            screenShareTrack: VisibilityState.UNKNOWN,
          }),
          videoTrack: VisibilityState.VISIBLE,
          screenShareTrack:
            remoteParticipant.viewportVisibilityState?.screenShareTrack ?? VisibilityState.UNKNOWN,
        },
      });

      call.state.updateParticipantTracks('videoTrack', {
        [remoteParticipant.sessionId]: {
          dimension: { width: 1280, height: 720 },
        },
      });
    }

    call.trackSubscriptionManager.apply(DebounceType.IMMEDIATE);
  }, [
    call,
    remoteParticipant?.sessionId,
    remoteParticipant?.videoDimension?.height,
    remoteParticipant?.videoDimension?.width,
    remoteParticipant?.viewportVisibilityState?.videoTrack,
    remoteTrackKey,
  ]);

  return (
    <View style={styles.screen}>
      {/* Remote Participant (Full Screen) */}
      {remoteParticipant ? (
        <View style={StyleSheet.absoluteFill}>
          <VideoTile
            stream={remoteParticipant.videoStream as MediaStream | undefined}
            label={remoteParticipant.userId}
            debug={`tracks: ${(remoteParticipant.publishedTracks ?? []).join(',') || 'nenhum'} | stream: ${remoteParticipant.videoStream ? 'sim' : 'nao'}`}
          />
        </View>
      ) : (
        <View style={styles.waitingContainer}>
          <Text style={styles.waitingText}>Aguardando o outro participante...</Text>
        </View>
      )}

      {/* Local Participant (PiP) */}
      {localParticipant && (
        <View style={styles.localVideoContainer}>
          <VideoTile
            stream={(localCameraStream ?? localParticipant.videoStream) as MediaStream | undefined}
            label="Você"
            mirror={direction === 'front'}
            zOrder={1}
            debug={`tracks: ${(localParticipant.publishedTracks ?? []).join(',') || 'nenhum'} | stream: ${localCameraStream || localParticipant.videoStream ? 'sim' : 'nao'}`}
          />
        </View>
      )}

      {/* Controls */}
      <CustomStreamCallControls />

      <CallHeader sessionId={sessionId} userId={userId} role={role} onLeave={onLeave} />
    </View>
  );
}

export function CallScreen({
  sessionId,
  callId,
  callType,
  token,
  apiKey,
  userId,
  role,
  onLeave,
}: Props) {
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  const [client] = useState(
    () =>
      StreamVideoClient.getOrCreateInstance({
        apiKey,
        user: { id: userId, name: userId },
        token,
      }),
  );

  const [call] = useState(() => client.call(callType, callId));

  const exitCall = useCallback(async () => {
    try {
      await api.notifyLeft(sessionId, userId);
    } catch {}
    try {
      await call.leave();
    } catch {}
    try {
      await client.disconnectUser();
    } catch {}
    onLeaveRef.current();
  }, [call, client, sessionId, userId]);

  return (
    <StreamVideo client={client}>
      <StreamCall call={call}>
        <CallContentWrapper
          sessionId={sessionId}
          userId={userId}
          role={role}
          call={call}
          onLeave={exitCall}
        />
      </StreamCall>
    </StreamVideo>
  );
}

function CallContentWrapper({
  sessionId,
  userId,
  role,
  call,
  onLeave,
}: {
  sessionId: string;
  userId: string;
  role: 'paciente' | 'medico';
  call: ReturnType<StreamVideoClient['call']>;
  onLeave(): void;
}) {
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(true);
  const joinedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function joinCall() {
      try {
        setIsJoining(true);
        setJoinError(null);

        if (Platform.OS === 'android') {
          const granted = await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.CAMERA,
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          ]);
          console.log('Permissões Android:', granted);

          const cameraGranted = granted[PermissionsAndroid.PERMISSIONS.CAMERA] === 'granted';
          const audioGranted = granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === 'granted';

          if (!cameraGranted || !audioGranted) {
            throw new Error(
              'Permissões de câmera e microfone são necessárias para a videoconsulta. Acesse as configurações do aplicativo para conceder as permissões.',
            );
          }
        }

        // callManager MUST be started before join to configure audio routing
        callManager.start({
          audioRole: 'communicator',
          deviceEndpointType: 'speaker',
        });

        // join() must happen first so CallingState becomes JOINED.
        // The SDK's DeviceManager only calls publishStream() when CallingState === JOINED,
        // so enabling devices before join acquires the stream but never publishes it.
        await call.join({ create: true });
        if (cancelled) return;

        // Now that we are JOINED, enable camera and mic explicitly.
        // This guarantees publishStream() is called regardless of the call type's
        // camera_default_on setting.
        const mediaResults = await Promise.allSettled([
          call.camera.enable().then(() => console.log('[mobile] câmera publicada')),
          call.microphone.enable().then(() => console.log('[mobile] mic publicado')),
        ]);

        const cameraResult = mediaResults[0];
        const microphoneResult = mediaResults[1];
        if (cameraResult.status === 'rejected') {
          throw new Error(`Falha ao publicar câmera: ${cameraResult.reason?.message ?? String(cameraResult.reason)}`);
        }
        if (microphoneResult.status === 'rejected') {
          throw new Error(`Falha ao publicar microfone: ${microphoneResult.reason?.message ?? String(microphoneResult.reason)}`);
        }

        joinedRef.current = true;
        await api.notifyJoined(sessionId, userId);
      } catch (err) {
        if (!cancelled) {
          setJoinError((err as Error).message ?? 'Falha ao entrar na call');
        }
      } finally {
        if (!cancelled) setIsJoining(false);
      }
    }

    joinCall();

    return () => {
      cancelled = true;
      if (joinedRef.current) {
        callManager.stop();
        call.leave().catch(() => undefined);
        joinedRef.current = false;
      }
    };
  }, [call, sessionId, userId]);

  if (joinError) {
    return (
      <SafeAreaView style={styles.statusScreen} edges={['top', 'bottom']}>
        <Text style={styles.statusTitle}>Não foi possível entrar na chamada</Text>
        <Text style={styles.statusMsg}>{joinError}</Text>
        <TouchableOpacity style={styles.btnBack} onPress={onLeave}>
          <Text style={styles.btnBackText}>Voltar</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (isJoining) {
    return (
      <SafeAreaView style={styles.statusScreen} edges={['top', 'bottom']}>
        <ActivityIndicator size="large" color="#3BA890" />
        <Text style={styles.joiningText}>Conectando à consulta…</Text>
      </SafeAreaView>
    );
  }

  return <CustomCallLayout sessionId={sessionId} userId={userId} role={role} call={call} onLeave={onLeave} />;
}

// ─── Design tokens (baseados em doutor-clin-profissionais-mobile) ─────────────
const C = {
  primary: '#3BA890',
  secondary: '#263870',
  danger: '#D92D20',
  dangerDark: '#911513',
  veto: '#6f42c1',
  white: '#FFFFFF',
  textMuted: '#A4A7AE',
};

const STATE_COLORS: Record<string, string> = {
  criada: '#535862',
  aguardando: '#B45309',
  midia_pendente: '#B45309',
  ativa: C.primary,
  encerrada: '#535862',
  vetada: C.danger,
};

const STATE_BG: Record<string, string> = {
  criada: '#F3F4F6',
  aguardando: '#FEF3C7',
  midia_pendente: '#FEF3C7',
  ativa: '#F0FDF9',
  encerrada: '#F3F4F6',
  vetada: '#FEF2F2',
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000',
  },
  localVideoContainer: {
    position: 'absolute',
    bottom: 100,
    right: 16,
    width: 100,
    height: 150,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
    zIndex: 50,
  },
  videoTile: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  noVideoTile: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#111827',
  },
  noVideoText: {
    color: C.white,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  noVideoDebug: {
    color: C.textMuted,
    fontSize: 10,
    marginTop: 6,
    textAlign: 'center',
  },
  videoLabel: {
    position: 'absolute',
    bottom: 6,
    left: 8,
    color: C.white,
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  waitingContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
  },
  waitingText: {
    color: '#adb5bd',
    fontSize: 16,
  },

  // Loading / error screens
  statusScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: C.white,
    gap: 16,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.secondary,
    textAlign: 'center',
  },
  statusMsg: {
    fontSize: 14,
    color: C.textMuted,
    textAlign: 'center',
  },
  joiningText: {
    fontSize: 15,
    fontWeight: '500',
    color: C.secondary,
    marginTop: 8,
  },

  // Header bar — absolute no TOPO para não sobrepor os controles nativos do Stream
  headerBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(15, 15, 20, 0.92)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
    zIndex: 100,
  },
  stateBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  stateText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 8,
    flexShrink: 1,
  },
  btnEnd: {
    backgroundColor: C.danger,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnVeto: {
    backgroundColor: C.veto,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnEndText: {
    color: C.white,
    fontWeight: '700',
    fontSize: 13,
  },

  // Back button on error screen
  btnBack: {
    backgroundColor: C.secondary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 8,
  },
  btnBackText: {
    color: C.white,
    fontSize: 15,
    fontWeight: '700',
  },

  // Legacy — mantidos para compatibilidade interna
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: C.white,
    gap: 16,
  },
  errorTitle: { fontSize: 18, fontWeight: '700', color: C.secondary },
  errorMessage: { fontSize: 14, color: C.textMuted, textAlign: 'center' },
});
