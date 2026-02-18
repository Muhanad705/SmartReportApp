import React, { useEffect, useState } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";

import AuthStack from "./AuthStack";
import UserStack from "./UserStack";
import AdminStack from "./AdminStack";
import ManagerStack from "./ManagerStack";
import EmployeeStack from "./EmployeeStack";

const Stack = createNativeStackNavigator();

export default function RootStack() {
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState(null);

  useEffect(() => {
    (async () => {
      const isLoggedIn = await AsyncStorage.getItem("isLoggedIn");
      const storedRole = await AsyncStorage.getItem("userRole"); 
      if (isLoggedIn === "true") {
        setRole(storedRole || "user");
      } else {
        setRole(null);
      }
      setReady(true);
    })();
  }, []);

  if (!ready) return null;

  const renderByRole = () => {
    switch (role) {
      case "admin":
        return <Stack.Screen name="Admin" component={AdminStack} />;
      case "manager":
        return <Stack.Screen name="Manager" component={ManagerStack} />;
      case "employee":
        return <Stack.Screen name="Employee" component={EmployeeStack} />;
      case "user":
        return <Stack.Screen name="User" component={UserStack} />;
      default:
        return <Stack.Screen name="Auth" component={AuthStack} />;
    }
  };

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {renderByRole()}
    </Stack.Navigator>
  );
}
