import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";

import { useThemeApp } from "../../theme/ThemeContext";
import { API_BASE_URL } from "../../services/api";

const SESSION_KEY = "local_session_v1";
const PROFILE_KEY = "local_user_profile";

const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export default function LoginScreen({ navigation }) {
  const { colors, mode } = useThemeApp();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const validate = () => {
    if (!email || !password) return "يرجى ملء جميع الحقول";
    if (!emailRegex.test(email)) return "البريد الإلكتروني غير صحيح";
    return null;
  };

  const onLogin = async () => {
    const err = validate();
    if (err) return Alert.alert("تسجيل الدخول", err);

    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        return Alert.alert("تسجيل الدخول", data?.message || "البريد الإلكتروني أو كلمة المرور غير صحيحة");
      }

      const token = data?.token;
      const user = data?.user;

      if (!token || !user?.email) {
        return Alert.alert("تسجيل الدخول", "ردّ السيرفر ناقص (token/user). تأكد من auth.controller.");
      }

      const role = user.role || "user";

      // جلسة موحّدة
      await AsyncStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ isLoggedIn: true, role, email: user.email, token })
      );

      await AsyncStorage.setItem(
        PROFILE_KEY,
        JSON.stringify({
          fullName: user.fullName || "",
          phone: user.phone || "",
          email: user.email || "",
          civilId: user.nationalId || "",
        })
      );

      // مهم: RootStack عندك كان يقرأ "true" — خلّه يقرأ "1" أو احنا نخزن "true"
      // أنا بخليها "true" عشان توافق كود RootStack الحالي
      await AsyncStorage.setItem("isLoggedIn", "true");
      await AsyncStorage.setItem("userRole", role);

      // لو AuthStack فيه UserStack مؤقت:
      navigation.replace("UserStack");
    } catch (e) {
      Alert.alert("خطأ", "ما قدرنا نتصل بالسيرفر. تأكد إن backend شغال وIP والمنفذ صحيحين.");
    }
  };

  const onFaceId = () => {
    Alert.alert("قريبًا", "بنفعّل Face ID لاحقًا إن شاء الله.");
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>تسجيل الدخول</Text>

        <TextInput
          style={[
            styles.input,
            { backgroundColor: colors.card, borderColor: colors.border, color: colors.text },
          ]}
          placeholder="البريد الإلكتروني"
          placeholderTextColor={colors.subText}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={email}
          onChangeText={setEmail}
        />

        <TextInput
          style={[
            styles.input,
            { backgroundColor: colors.card, borderColor: colors.border, color: colors.text },
          ]}
          placeholder="كلمة المرور"
          placeholderTextColor={colors.subText}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity
          style={[styles.primary, { backgroundColor: colors.primary }]}
          onPress={onLogin}
          activeOpacity={0.9}
        >
          <Text style={styles.primaryText}>دخول</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.faceBtn,
            {
              backgroundColor: mode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
              borderColor: colors.border,
            },
          ]}
          onPress={onFaceId}
          activeOpacity={0.9}
        >
          <Ionicons name="scan-outline" size={18} color={colors.text} />
          <Text style={[styles.faceText, { color: colors.text }]}>الدخول بـ Face ID</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("ForgotPassword")} activeOpacity={0.85}>
          <Text style={[styles.link, { color: colors.primary }]}>نسيت كلمة المرور؟</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("SignUp")} activeOpacity={0.85}>
          <Text style={[styles.link, { color: colors.primary }]}>ليس لديك حساب؟ انشئ حساب</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", padding: 16 },
  card: { borderRadius: 18, padding: 16, borderWidth: 1 },
  title: { fontSize: 20, fontWeight: "900", marginBottom: 10 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
    fontSize: 14,
    fontWeight: "700",
  },
  primary: { marginTop: 14, paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "900", fontSize: 15 },
  faceBtn: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  faceText: { fontWeight: "900", fontSize: 14 },
  link: { marginTop: 10, textAlign: "center", fontSize: 14, fontWeight: "800" },
});
