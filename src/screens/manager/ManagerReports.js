import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useThemeApp } from "../../theme/ThemeContext";
import { managerApi } from "../../services/managerApi";

const FILTERS = [
  { key: "", label: "الكل" },
  { key: "in_progress", label: "قيد المعالجة" },
  { key: "accepted", label: "ناجحة" },
  { key: "rejected", label: "مرفوضة" },
];

function fmtDate(v) {
  const d = v ? new Date(v) : null;
  if (!d || isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export default function ManagerReports({ navigation }) {
  const { colors } = useThemeApp();
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);

  async function load(nextStatus = status) {
    try {
      setLoading(true);
      const r = await managerApi.reports(nextStatus);
      setItems(r.items || []);
    } catch (e) {
      Alert.alert("خطأ", e.message || "Server error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(status);
  }, [status]);

  const s = useMemo(() => styles(colors), [colors]);

  const renderItem = ({ item }) => {
    const title = item.Description ? String(item.Description).slice(0, 60) : "بلاغ بدون وصف";
    const sub = `${item.ReporterName || "مبلّغ"} • ${item.ReporterPhone || ""}`;
    const meta = `${item.Status || ""} • ${fmtDate(item.CreatedAt || item.createdAt)}`;

    return (
      <TouchableOpacity
        style={s.row}
        onPress={() => navigation.navigate("ManagerReportDetails", { id: item.Id })}
      >
        <View style={{ flex: 1 }}>
          <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
          <Text style={s.rowSub} numberOfLines={1}>{sub}</Text>
          <Text style={s.rowMeta} numberOfLines={1}>{meta}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.subText} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.container}>
      <View style={s.filters}>
        {FILTERS.map((f) => {
          const active = f.key === status;
          return (
            <TouchableOpacity
              key={f.key || "all"}
              onPress={() => setStatus(f.key)}
              style={[s.filterBtn, active && s.filterBtnActive]}
            >
              <Text style={[s.filterText, active && s.filterTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={s.refreshBtn} onPress={() => load(status)}>
          <Ionicons name="refresh" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator />
        </View>
      ) : items.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="folder-open" size={30} color={colors.subText} />
          <Text style={s.empty}>لا توجد بلاغات هنا.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => String(it.Id)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 16 }}
        />
      )}
    </View>
  );
}

const styles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, padding: 12 },
    filters: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" },

    filterBtn: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: colors.soft,
      borderWidth: 1,
      borderColor: colors.border,
    },
    filterBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    filterText: { color: colors.text, fontWeight: "700" },
    filterTextActive: { color: "#fff" },

    refreshBtn: {
      marginLeft: "auto",
      padding: 10,
      borderRadius: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },

    row: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 10,
    },
    rowTitle: { color: colors.text, fontWeight: "900" },
    rowSub: { color: colors.subText, marginTop: 4, fontWeight: "700" },
    rowMeta: { color: colors.subText, marginTop: 6 },

    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
    empty: { color: colors.subText, fontWeight: "700" },
  });