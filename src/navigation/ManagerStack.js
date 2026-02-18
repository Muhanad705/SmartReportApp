import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { View, Text } from "react-native";

const Stack = createNativeStackNavigator();

function AdminHome() {
  return <View><Text>Admin Home</Text></View>;
}

export default function AdminStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="manHome" component={AdminHome} />
    </Stack.Navigator>
  );
}
