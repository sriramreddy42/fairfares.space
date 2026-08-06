import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { createDiagnosticReference, reportDiagnostic } from "../utils/monitoring";

type State = { crashed: boolean; referenceId: string };

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { crashed: false, referenceId: "" };

  static getDerivedStateFromError() {
    return { crashed: true, referenceId: createDiagnosticReference() };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    void reportDiagnostic({
      kind: "render_crash",
      error,
      stack: `${error.stack || ""}\n${info.componentStack || ""}`,
      screen: "app_root",
      referenceId: this.state.referenceId
    });
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <View style={styles.page} accessibilityRole="alert">
        <Text style={styles.title}>FairFares needs to restart</Text>
        <Text style={styles.copy}>We recorded the problem without including your messages, password, or payment details.</Text>
        <Text selectable style={styles.reference}>Reference: {this.state.referenceId}</Text>
        <TouchableOpacity style={styles.button} onPress={() => this.setState({ crashed: false, referenceId: "" })}>
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#080b0f", justifyContent: "center", padding: 28 },
  title: { color: "#ffffff", fontSize: 24, fontWeight: "700", marginBottom: 12 },
  copy: { color: "#bcc4d0", fontSize: 16, lineHeight: 23, marginBottom: 14 },
  reference: { color: "#65d99a", fontSize: 14, marginBottom: 24 },
  button: { minHeight: 50, borderRadius: 16, backgroundColor: "#4777f5", alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "700" }
});
