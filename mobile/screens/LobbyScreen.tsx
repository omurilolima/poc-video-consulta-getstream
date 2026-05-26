import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Share,
  ScrollView,
  Pressable,
  Keyboard,
} from 'react-native';
import { api, BACKEND_URL } from '../services/api';

interface Props {
  onJoin(params: {
    sessionId: string;
    callId: string;
    callType: string;
    token: string;
    apiKey: string;
    userId: string;
    role: 'paciente' | 'medico';
  }): void;
}

interface PendingCall {
  sessionId: string;
  callId: string;
  callType: string;
  token: string;
  apiKey: string;
}

export function LobbyScreen({ onJoin }: Props) {
  const [sessionId, setSessionId] = useState('');
  const [userId, setUserId] = useState('murilo');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<PendingCall | null>(null);
  const [userIdFocused, setUserIdFocused] = useState(false);
  const [sessionIdFocused, setSessionIdFocused] = useState(false);

  // O app mobile é sempre o paciente nesta PoC
  const role = 'paciente';

  async function handleCreateSession() {
    if (!userId.trim()) {
      Alert.alert('Campo obrigatório', 'Informe um userId para continuar.');
      return;
    }
    setLoading(true);
    setPending(null);
    try {
      const { sessionId: newId, callId, callType } = await api.createSession();
      const { token, apiKey } = await api.getToken(newId, userId.trim(), role);
      setPending({ sessionId: newId, callId, callType, token, apiKey });
    } catch (e) {
      Alert.alert('Erro ao criar sessão', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleEnterCreated() {
    if (!pending) return;
    Keyboard.dismiss();
    onJoin({ ...pending, userId: userId.trim(), role });
  }

  async function handleJoinExisting() {
    const rawId = sessionId.trim().replace(/:$/, ''); // Remove espaços e possíveis dois-pontos
    const rawUserId = userId.trim();

    if (!rawId || !rawUserId) {
      Alert.alert('Campos obrigatórios', 'Informe Session ID e userId.');
      return;
    }
    Keyboard.dismiss();
    setLoading(true);
    try {
      const { callId, callType, token, apiKey } = await api.getToken(
        rawId,
        rawUserId,
        role,
      );
      onJoin({ sessionId: rawId, callId, callType, token, apiKey, userId: rawUserId, role });
    } catch (e) {
      Alert.alert('Erro ao entrar na sessão', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>POC Videoconsulta</Text>
        <Text style={styles.subtitle}>GetStream Video — Prova de Conceito</Text>
        <Text style={styles.backendLabel}>{BACKEND_URL}</Text>
      </View>

      {/* userId */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Seu identificador</Text>
        <TextInput
          style={[styles.input, userIdFocused && styles.inputFocused]}
          value={userId}
          onChangeText={setUserId}
          placeholder="ex: paciente-01"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={() => setUserIdFocused(true)}
          onBlur={() => setUserIdFocused(false)}
        />
      </View>

      {/* CTA criar sessão */}
      <Pressable
        style={({ pressed }) => [
          styles.btnPrimary,
          (loading || pressed) && styles.btnPrimaryPressed,
          loading && styles.btnDisabled,
        ]}
        onPress={handleCreateSession}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnPrimaryText}>Criar nova sessão</Text>
        )}
      </Pressable>

      {/* Card de sessão criada */}
      {pending ? (
        <View style={styles.pendingCard}>
          <View style={styles.pendingCardHeader}>
            <View style={styles.pendingDot} />
            <Text style={styles.pendingCardTitle}>Sessão criada com sucesso</Text>
          </View>
          <Text style={styles.pendingCardLabel}>Session ID</Text>
          <TextInput
            style={styles.pendingIdInput}
            value={pending.sessionId}
            editable={false}
            selectTextOnFocus
            multiline
          />
          <View style={styles.pendingActions}>
            <Pressable
              style={({ pressed }) => [styles.btnOutline, pressed && styles.btnOutlinePressed]}
              onPress={() => Share.share({ message: pending.sessionId })}
            >
              <Text style={styles.btnOutlineText}>Compartilhar ID</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.btnEnter, pressed && styles.btnEnterPressed]}
              onPress={handleEnterCreated}
            >
              <Text style={styles.btnPrimaryText}>Entrar na chamada →</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Divider */}
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>ou entre em uma sessão existente</Text>
        <View style={styles.dividerLine} />
      </View>

      {/* Session ID para entrar */}
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Session ID</Text>
        <TextInput
          style={[styles.input, sessionIdFocused && styles.inputFocused]}
          value={sessionId}
          onChangeText={setSessionId}
          placeholder="cole o sessionId aqui"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={() => setSessionIdFocused(true)}
          onBlur={() => setSessionIdFocused(false)}
        />
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.btnSecondary,
          (loading || pressed) && styles.btnSecondaryPressed,
          loading && styles.btnDisabled,
        ]}
        onPress={handleJoinExisting}
        disabled={loading}
      >
        <Text style={styles.btnSecondaryText}>Entrar na sessão</Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── Design tokens (baseados em doutor-clin-profissionais-mobile) ─────────────
const C = {
  primary: '#3BA890',
  primaryDark: '#287969',
  secondary: '#263870',
  white: '#FFFFFF',
  bg: '#F5F7FA',
  border: '#D3D3D3',
  borderFocus: '#3BA890',
  text: '#1F2937',
  textMuted: '#535862',
  textDisabled: '#A4A7AE',
  danger: '#D92D20',
  successBg: '#F0FDF9',
  successBorder: '#A7F3D0',
};

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: C.white,
  },
  container: {
    padding: 20,
    paddingBottom: 40,
    gap: 0,
  },

  // Header
  header: {
    marginBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: C.secondary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: C.primary,
    marginBottom: 4,
  },
  backendLabel: {
    fontSize: 11,
    color: C.textDisabled,
    fontFamily: 'monospace',
  },

  // Fields
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textMuted,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    color: C.text,
    backgroundColor: C.white,
  },
  inputFocused: {
    borderColor: C.borderFocus,
    borderWidth: 1.5,
  },

  // Role selector
  roleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  roleBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    backgroundColor: C.white,
  },
  roleBtnActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  roleBtnPressed: {
    opacity: 0.8,
  },
  roleBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: C.textMuted,
  },
  roleBtnTextActive: {
    color: C.white,
    fontWeight: '700',
  },

  // Buttons
  btnPrimary: {
    backgroundColor: C.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 16,
    minHeight: 48,
    justifyContent: 'center',
  },
  btnPrimaryPressed: {
    backgroundColor: C.primaryDark,
  },
  btnPrimaryText: {
    color: C.white,
    fontSize: 15,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.55,
  },
  btnSecondary: {
    backgroundColor: C.white,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: C.secondary,
    minHeight: 48,
    justifyContent: 'center',
  },
  btnSecondaryPressed: {
    backgroundColor: '#F0F3FC',
  },
  btnSecondaryText: {
    color: C.secondary,
    fontSize: 15,
    fontWeight: '700',
  },
  btnOutline: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOutlinePressed: {
    backgroundColor: '#F0FDF9',
  },
  btnOutlineText: {
    color: C.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  btnEnter: {
    flex: 1,
    backgroundColor: C.secondary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnEnterPressed: {
    backgroundColor: '#1a2854',
  },

  // Pending card
  pendingCard: {
    backgroundColor: C.successBg,
    borderWidth: 1,
    borderColor: C.successBorder,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 10,
  },
  pendingCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pendingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.primary,
  },
  pendingCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.primary,
  },
  pendingCardLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pendingIdInput: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: C.secondary,
    backgroundColor: C.white,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.successBorder,
    padding: 10,
  },
  pendingActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },

  // Divider
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: C.border,
  },
  dividerText: {
    fontSize: 12,
    color: C.textDisabled,
    textAlign: 'center',
    flexShrink: 1,
  },
});
