import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useThemeApp } from "../../theme/ThemeContext";
import { managerApi } from "../../services/managerApi";

function fmtDate(v) {
  const d = v ? new Date(v) : null;
  if (!d || isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export default function ManagerReportDetails({ route }) {
  const { colors } = useThemeApp();
  const { id } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  async function load() {
    try {
      setLoading(true);
      const r = await managerApi.reportDetails(id);
      setData(r);
    } catch (e) {
      Alert.alert("خطأ", e.message || "Server error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  const s = useMemo(() => styles(colors), [colors]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const report = data?.report || {};
  const media = data?.media || [];
  const history = data?.history || [];

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 18 }}>
      <Card title="معلومات البلاغ" colors={colors}>
        <InfoRow label="الحالة" value={String(report.Status || "")} colors={colors} />
        <InfoRow label="التاريخ" value={fmtDate(report.CreatedAt || report.createdAt)} colors={colors} />
        <InfoRow label="الوصف" value={String(report.Description || "")} colors={colors} />
        <InfoRow
          label="الموقع"
          value={
            report.LocationLat && report.LocationLng
              ? `${report.LocationLat}, ${report.LocationLng}`
              : "غير محدد"
          }
          colors={colors}
        />
      </Card>

      <Card title="بيانات المبلّغ" colors={colors}>
        <InfoRow label="الاسم" value={String(report.ReporterName || "")} colors={colors} />
        <InfoRow label="الجوال" value={String(report.ReporterPhone || "")} colors={colors} />
        {report.ReporterEmail ? <InfoRow label="البريد" value={String(report.ReporterEmail)} colors={colors} /> : null}
      </Card>

      <Card title="المرفقات" colors={colors}>
        {media.length === 0 ? (
          <Text style={s.muted}>لا يوجد مرفقات.</Text>
        ) : (
          media.map((m) => (
            <View key={String(m.Id)} style={s.mediaRow}>
              <Ionicons name={m.Type === "video" ? "videocam" : "image"} size={18} color={colors.text} />
              <Text style={s.mediaText} numberOfLines={1}>{String(m.FileUrl || "")}</Text>
            </View>
          ))
        )}
        <Text style={s.note}>
          * حاليًا نعرض روابط المرفقات. إذا تبغى نعرض الصور/الفيديو داخل التطبيق بنضيف Image/Video viewer.
        </Text>
      </Card>

      <Card title="سجل تغيير الحالة" colors={colors}>
        {history.length === 0 ? (
          <Text style={s.muted}>لا يوجد سجل.</Text>
        ) : (
          history.map((h) => (
            <View key={String(h.Id)} style={s.historyRow}>
              <Text style={s.historyTitle}>
                {h.FromStatus} → {h.ToStatus}
              </Text>
              <Text style={s.historyMeta}>
                بواسطة: {h.ChangedByName || h.ChangedBy || "-"} • {fmtDate(h.ChangedAt)}
              </Text>
              {h.Note ? <Text style={s.historyNote}>سبب/ملاحظة: {String(h.Note)}</Text> : null}
            </View>
          ))
        )}
      </Card>

      <TouchableOpacity style={s.refreshBtn} onPress={load}>
        <Ionicons name="refresh" size={18} color="#fff" />
        <Text style={s.refreshText}>تحديث</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Card({ title, children, colors }) {
  const s = styles(colors);
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{title}</Text>
      <View style={{ marginTop: 10, gap: 10 }}>{children}</View>
    </View>
  );
}

function InfoRow({ label, value, colors }) {
  const s = styles(colors);
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value || "-"}</Text>
    </View>
  );
}

const styles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, padding: 12 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },

    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
    },
    cardTitle: { color: colors.text, fontWeight: "900", fontSize: 16 },

    infoRow: { gap: 4 },
    infoLabel: { color: colors.subText, fontWeight: "800" },
    infoValue: { color: colors.text, fontWeight: "700" },

    muted: { color: colors.subText, fontWeight: "700" },
    mediaRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
    mediaText: { color: colors.text, flex: 1 },
    note: { color: colors.subText, marginTop: 8, fontSize: 12 },

    historyRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
    historyTitle: { color: colors.text, fontWeight: "900" },
    historyMeta: { color: colors.subText, marginTop: 4 },
    historyNote: { color: colors.text, marginTop: 6 },

    refreshBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      padding: 14,
      borderRadius: 16,
      backgroundColor: colors.primary,
      marginTop: 6,
    },
    refreshText: { color: "#fff", fontWeight: "900" },
  });