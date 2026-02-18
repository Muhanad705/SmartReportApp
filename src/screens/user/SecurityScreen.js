// src/screens/user/SecurityScreen.js
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Modal,
  Pressable,
  Alert,
  ScrollView,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";

import { useThemeApp } from "../../theme/ThemeContext";

const KEY_BIOMETRICS = "security_biometrics_enabled";
const KEY_AUTO_LOGOUT = "security_auto_logout_enabled";
const KEY_SESSIONS = "security_sessions_demo";

function nowISO() {
  return new Date().toISOString();
}

function formatDateAr(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ar", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}



export default function SecurityScreen({ navigation }) {
  const { mode, colors, ready } = useThemeApp();

  const C = useMemo(
    () => ({
      title: "الأمان",
      sub: "تحكم بخيارات الحماية والجلسات",
      biometrics: "البصمة / الوجه",
      biometricsHint: "استخدم بصمة الإصبع أو Face ID (تجريبي)",
      autoLogout: "تسجيل خروج تلقائي",
      autoLogoutHint: "تسجيل خروج بعد فترة عدم نشاط (تجريبي)",
      sessions: "الجلسات النشطة",
      sessionsHint: "إدارة الأجهزة المسجلة على الحساب (تجريبي)",
      note: "ملاحظة: هذه الخيارات تجريبية حالياً إلى أن يتم ربط Backend أو Firebase.",
      notePopupTitle: "تنبيه",
      notePopupText: "ميزة البصمة تجريبية حالياً، وسيتم ربطها لاحقاً بالنظام الحقيقي.",
      thisDevice: "هذا الجهاز",
      laptopSession: "جلسة على كمبيوتر",
      currentTag: "(الحالي)",
      done: "تم",
      signedOutOthers: "تم تسجيل الخروج من جميع الأجهزة الأخرى.",
      signOutOthers: "تسجيل خروج من الأجهزة الأخرى",
      close: "إغلاق",
    }),
    []
  );

  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [autoLogoutEnabled, setAutoLogoutEnabled] = useState(false);

  const [sessionsModal, setSessionsModal] = useState(false);
  const [sessions, setSessions] = useState([]);

  const styles = useMemo(() => makeStyles(colors, mode), [colors, mode]);

  useEffect(() => {
   
    navigation?.setOptions?.({ headerShown: true });
  }, [navigation]);

  const seedSessionsIfEmpty = useCallback(async () => {
    const existing = await AsyncStorage.getItem(KEY_SESSIONS);
    if (existing) return;

    const demo = [
      {
        id: "s_current",
        name: C.thisDevice,
        detail: Platform.OS === "ios" ? "iPhone" : "Android",
        lastActive: nowISO(),
        current: true,
      },
      {
        id: "s_2",
        name: C.laptopSession,
        detail: "Windows",
        lastActive: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
        current: false,
      },
    ];

    await AsyncStorage.setItem(KEY_SESSIONS, JSON.stringify(demo));
  }, [C.thisDevice, C.laptopSession]);

  const loadAll = useCallback(async () => {
    await seedSessionsIfEmpty();

    const b = await AsyncStorage.getItem(KEY_BIOMETRICS);
    const a = await AsyncStorage.getItem(KEY_AUTO_LOGOUT);
    const s = await AsyncStorage.getItem(KEY_SESSIONS);

    setBiometricsEnabled(b === "true");
    setAutoLogoutEnabled(a === "true");
    setSessions(s ? JSON.parse(s) : []);
  }, [seedSessionsIfEmpty]);

  useEffect(() => {
    if (!ready) return;
    loadAll();
  }, [ready, loadAll]);

  const toggleBiometrics = async (v) => {
    setBiometricsEnabled(v);
    await AsyncStorage.setItem(KEY_BIOMETRICS, v ? "true" : "false");
    if (v) Alert.alert(C.notePopupTitle, C.notePopupText);
  };

  const toggleAutoLogout = async (v) => {
    setAutoLogoutEnabled(v);
    await AsyncStorage.setItem(KEY_AUTO_LOGOUT, v ? "true" : "false");
  };

  const openSessions = async () => {
    await loadAll();
    setSessionsModal(true);
  };

  const signOutSession = async (id) => {
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    await AsyncStorage.setItem(KEY_SESSIONS, JSON.stringify(next));
  };

  const signOutAll = async () => {
    const current = sessions.find((s) => s.current);
    const next = current ? [current] : [];
    setSessions(next);
    await AsyncStorage.setItem(KEY_SESSIONS, JSON.stringify(next));
    Alert.alert(C.done, C.signedOutOthers);
  };

  if (!ready) return null;

  return (
    <View style={styles.root}>
      

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.title}>{C.title}</Text>
          <Text style={styles.sub}>{C.sub}</Text>

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <View style={styles.iconBox}>
                <Ionicons name="scan-outline" size={18} color={colors.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>{C.biometrics}</Text>
                <Text style={styles.sectionHint}>{C.biometricsHint}</Text>
              </View>

              <Switch
                value={biometricsEnabled}
                onValueChange={toggleBiometrics}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={Platform.OS === "android" ? "#fff" : undefined}
              />
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <View style={styles.iconBox}>
                <Ionicons name="time-outline" size={18} color={colors.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>{C.autoLogout}</Text>
                <Text style={styles.sectionHint}>{C.autoLogoutHint}</Text>
              </View>

              <Switch
                value={autoLogoutEnabled}
                onValueChange={toggleAutoLogout}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={Platform.OS === "android" ? "#fff" : undefined}
              />
            </View>
          </View>

          <View style={styles.section}>
            <TouchableOpacity style={styles.actionRow} activeOpacity={0.9} onPress={openSessions}>
              <View style={styles.iconBox}>
                <Ionicons name="laptop-outline" size={18} color={colors.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionTitle}>{C.sessions}</Text>
                <Text style={styles.actionHint}>{C.sessionsHint}</Text>
              </View>
              <Ionicons name="chevron-back" size={20} color={colors.subText} />
            </TouchableOpacity>
          </View>

          <Text style={styles.note}>{C.note}</Text>
        </View>
      </ScrollView>

      <Modal visible={sessionsModal} transparent animationType="fade" onRequestClose={() => setSessionsModal(false)}>
        <View style={styles.modalWrap}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSessionsModal(false)} />

          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{C.sessions}</Text>
              <TouchableOpacity onPress={() => setSessionsModal(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            {sessions.map((s) => (
              <View key={s.id} style={styles.sessionRow}>
                <View style={styles.sessionLeft}>
                  <View style={styles.iconBoxSm}>
                    <Ionicons
                      name={s.current ? "phone-portrait-outline" : "laptop-outline"}
                      size={16}
                      color={colors.text}
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.sessionTitle}>
                      {s.name} {s.current ? ` ${C.currentTag}` : ""}
                    </Text>
                    <Text style={styles.sessionHint}>
                      {s.detail} • {formatDateAr(s.lastActive)}
                    </Text>
                  </View>
                </View>

                {!s.current && (
                  <TouchableOpacity style={styles.sessionBtn} onPress={() => signOutSession(s.id)} activeOpacity={0.9}>
                    <Ionicons name="log-out-outline" size={18} color="#B00020" />
                  </TouchableOpacity>
                )}
              </View>
            ))}

            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.dangerBtn} onPress={signOutAll} activeOpacity={0.9}>
                <Text style={styles.dangerBtnText}>{C.signOutOthers}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.ghostBtn} onPress={() => setSessionsModal(false)} activeOpacity={0.9}>
                <Text style={styles.ghostBtnText}>{C.close}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const base = StyleSheet.create({
  topBar: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  backText: { fontWeight: "900" },
  pageTitle: { fontSize: 16, fontWeight: "900" },
});

function makeStyles(colors, mode) {
  const shadow =
    mode === "dark"
      ? {}
      : { shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 };

  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    content: { padding: 16, paddingBottom: 22 },

    card: {
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow,
    },

    title: { fontSize: 18, fontWeight: "900", color: colors.text },
    sub: {
      marginTop: 4,
      fontSize: 12.5,
      fontWeight: "700",
      color: colors.subText,
      marginBottom: 10,
    },

    section: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: mode === "dark" ? "rgba(255,255,255,0.06)" : "#F1F2F6",
    },

    sectionHead: { flexDirection: "row", alignItems: "center", gap: 10 },

    iconBox: {
      width: 36,
      height: 36,
      borderRadius: 14,
      backgroundColor: colors.soft,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },

    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 12,
    },
    actionTitle: { fontSize: 14.5, fontWeight: "900", color: colors.text },
    actionHint: { marginTop: 2, fontSize: 12, fontWeight: "700", color: colors.subText },

    sectionTitle: { fontSize: 14.5, fontWeight: "900", color: colors.text },
    sectionHint: { marginTop: 2, fontSize: 12, fontWeight: "700", color: colors.subText },

    note: { marginTop: 14, fontSize: 12, fontWeight: "700", color: colors.subText, lineHeight: 18 },

    modalWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
    modalCard: {
      width: "92%",
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow,
    },
    modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
    modalTitle: { fontSize: 15.5, fontWeight: "900", color: colors.text },
    modalCloseBtn: {
      width: 36,
      height: 36,
      borderRadius: 14,
      backgroundColor: colors.soft,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },

    modalFooter: { marginTop: 14, flexDirection: "row", gap: 10 },
    ghostBtn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: colors.soft,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
    },
    ghostBtnText: { color: colors.text, fontWeight: "900" },

    dangerBtn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: mode === "dark" ? "#2A0E14" : "#FFF1F2",
      borderWidth: 1,
      borderColor: mode === "dark" ? "#5B1A24" : "#FFD5DA",
      alignItems: "center",
    },
    dangerBtnText: { color: "#B00020", fontWeight: "900" },

    sessionRow: {
      marginTop: 10,
      padding: 12,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.soft,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sessionLeft: { flexDirection: "row", gap: 10, alignItems: "center", flex: 1 },
    iconBoxSm: {
      width: 34,
      height: 34,
      borderRadius: 14,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    sessionTitle: { fontSize: 13.5, fontWeight: "900", color: colors.text },
    sessionHint: { marginTop: 2, fontSize: 12, fontWeight: "700", color: colors.subText },
    sessionBtn: {
      width: 40,
      height: 40,
      borderRadius: 16,
      backgroundColor: mode === "dark" ? "#2A0E14" : "#FFF1F2",
      borderWidth: 1,
      borderColor: mode === "dark" ? "#5B1A24" : "#FFD5DA",
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
