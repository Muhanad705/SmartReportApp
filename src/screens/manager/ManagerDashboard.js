import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  RefreshControl,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useThemeApp } from "../../theme/ThemeContext";
import { managerApi } from "../../services/managerApi";

const SESSION_KEY = "local_session_v1";
const PROFILE_KEY = "local_user_profile";

export default function ManagerDashboard({ navigation }) {
  const { colors } = useThemeApp();

  const [loading, setLoading] = useState(true); // تحميل أول مرة
  const [refreshing, setRefreshing] = useState(false); // سحب للتحديث
  const [stats, setStats] = useState({ total: 0, in_progress: 0, accepted: 0, rejected: 0 });

  const load = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const r = await managerApi.stats();
      setStats(r.stats || { total: 0, in_progress: 0, accepted: 0, rejected: 0 });
    } catch (e) {
      Alert.alert("خطأ", e.message || "Server error");
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  // ✅ يتحقق إن الشاشة موجودة قبل ما يعرض زرها / وين يودّي بعد الخروج
  const navInfo = useMemo(() => {
    const state = navigation.getState?.();
    const names = (state?.routeNames || state?.routes?.map((r) => r.name) || []).filter(Boolean);
    const set = new Set(names);
    return {
      has: (name) => set.has(name),
      routeNames: names,
    };
  }, [navigation]);

  const logout = useCallback(() => {
    Alert.alert("تسجيل الخروج", "متأكد تبغى تسجّل خروج؟", [
      { text: "إلغاء", style: "cancel" },
      {
        text: "خروج",
        style: "destructive",
        onPress: async () => {
          try {
            // امسح كل شيء يخص الجلسة
            await AsyncStorage.multiRemove([SESSION_KEY, PROFILE_KEY, "userRole"]);
            await AsyncStorage.setItem("isLoggedIn", "false");

            // ✅ reset للتنقل عشان ما يعلق على الستاك الحالي
            // جرّب Login أول، وإذا ما موجود جرّب AuthStack، وإذا ما موجود ارجع للخلف
            const target =
              navInfo.has("Login") ? "Login" :
              navInfo.has("AuthStack") ? "AuthStack" :
              null;

            if (target) {
              navigation.reset({ index: 0, routes: [{ name: target }] });
            } else {
              // fallback
              navigation.goBack?.();
            }
          } catch (e) {
            Alert.alert("خطأ", "فشل تسجيل الخروج");
          }
        },
      },
    ]);
  }, [navigation, navInfo]);

  const s = styles(colors);

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={{ paddingBottom: 18 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
    >
      {/* Header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>لوحة المدير</Text>
          <Text style={s.subtitle}>نظرة سريعة على بلاغات جهتك</Text>
        </View>

        <TouchableOpacity style={s.iconBtn} onPress={logout} accessibilityLabel="Logout">
          <Ionicons name="log-out-outline" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Stats */}
      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator />
        </View>
      ) : (
        <View style={s.grid}>
          <StatCard title="الإجمالي" value={stats.total} icon="stats-chart" colors={colors} />
          <StatCard title="قيد المعالجة" value={stats.in_progress} icon="time" colors={colors} />
          <StatCard title="ناجحة" value={stats.accepted} icon="checkmark-circle" colors={colors} />
          <StatCard title="مرفوضة" value={stats.rejected} icon="close-circle" colors={colors} />
        </View>
      )}

      {/* Actions */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>الإجراءات</Text>

        {navInfo.has("ManagerReports") ? (
          <PrimaryBtn
            title="بلاغات الجهة"
            subtitle="عرض البلاغات وتصفية الحالات"
            icon="document-text-outline"
            onPress={() => navigation.navigate("ManagerReports")}
            colors={colors}
          />
        ) : null}

        {navInfo.has("ManagerEmployees") ? (
          <SecondaryBtn
            title="الموظفون"
            subtitle="إدارة موظفي الجهة"
            icon="people-outline"
            onPress={() => navigation.navigate("ManagerEmployees")}
            colors={colors}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

function StatCard({ title, value, icon, colors }) {
  const s = styles(colors);
  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={s.iconBubble}>
          <Ionicons name={icon} size={18} color={colors.text} />
        </View>
        <Text style={s.cardTitle}>{title}</Text>
      </View>
      <Text style={s.cardValue}>{String(value ?? 0)}</Text>
    </View>
  );
}

function PrimaryBtn({ title, subtitle, icon, onPress, colors }) {
  const s = styles(colors);
  return (
    <TouchableOpacity style={s.primaryBtn} onPress={onPress}>
      <Ionicons name={icon} size={22} color="#fff" />
      <View style={{ flex: 1 }}>
        <Text style={s.primaryTitle}>{title}</Text>
        <Text style={s.primarySub}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#fff" />
    </TouchableOpacity>
  );
}

function SecondaryBtn({ title, subtitle, icon, onPress, colors }) {
  const s = styles(colors);
  return (
    <TouchableOpacity style={s.secondaryBtn} onPress={onPress}>
      <Ionicons name={icon} size={22} color={colors.text} />
      <View style={{ flex: 1 }}>
        <Text style={s.secondaryTitle}>{title}</Text>
        <Text style={s.secondarySub}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.subText} />
    </TouchableOpacity>
  );
}

const styles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, padding: 16 },

    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 14,
    },
    title: { color: colors.text, fontSize: 20, fontWeight: "900" },
    subtitle: { color: colors.subText, marginTop: 4, fontWeight: "700" },

    iconBtn: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },

    loadingWrap: {
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 18,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 6,
    },

    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
      marginTop: 6,
    },

    card: {
      width: "48%",
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    iconBubble: {
      width: 34,
      height: 34,
      borderRadius: 12,
      backgroundColor: colors.soft,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardTitle: { color: colors.subText, fontWeight: "800" },
    cardValue: { marginTop: 10, color: colors.text, fontSize: 26, fontWeight: "900" },

    section: { marginTop: 18 },
    sectionTitle: { color: colors.text, fontWeight: "900", marginBottom: 10, fontSize: 14 },

    primaryBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: colors.primary,
      padding: 16,
      borderRadius: 18,
    },
    primaryTitle: { color: "#fff", fontWeight: "900", fontSize: 16 },
    primarySub: { color: "#fff", opacity: 0.9, marginTop: 3, fontWeight: "700" },

    secondaryBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: colors.card,
      padding: 16,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: 10,
    },
    secondaryTitle: { color: colors.text, fontWeight: "900", fontSize: 16 },
    secondarySub: { color: colors.subText, marginTop: 3, fontWeight: "700" },
  });