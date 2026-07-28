import React, { useEffect, useMemo, useState } from "react";
import { Modal, ScrollView, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from "react-native";
import { theme } from "../theme";

type Props = {
  label: string;
  value: string;
  mode: "date" | "time";
  onChange: (value: string) => void;
  minimumDate?: string;
  maximumDate?: string;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
};

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayLocalIso() {
  return localIso(new Date());
}

function parseIso(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateLabel(value: string, placeholder: string) {
  const date = parseIso(value);
  return date ? date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : placeholder;
}

function timeLabel(hour: number, minute: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

const timeOptions = Array.from({ length: 48 }, (_item, index) => timeLabel(Math.floor(index / 2), (index % 2) * 30));

export function DateTimeField({ label, value, mode, onChange, minimumDate = "", maximumDate = "", placeholder, style }: Props) {
  const [open, setOpen] = useState(false);
  const initialDate = parseIso(value) || parseIso(minimumDate) || new Date();
  const [visibleMonth, setVisibleMonth] = useState(new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));

  useEffect(() => {
    if (!open || mode !== "date") return;
    const selected = parseIso(value) || parseIso(minimumDate) || new Date();
    setVisibleMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [minimumDate, mode, open, value]);

  const calendarCells = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: 42 }, (_item, index) => {
      const day = index - firstWeekday + 1;
      return day >= 1 && day <= days ? new Date(year, month, day) : null;
    });
  }, [visibleMonth]);

  const display = mode === "date" ? dateLabel(value, placeholder || "Select date") : value || placeholder || "Select time";

  return (
    <>
      <TouchableOpacity style={[styles.field, style]} onPress={() => setOpen(true)} accessibilityLabel={`${label}: ${display}`}>
        <View style={styles.fieldCopy}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <Text style={[styles.fieldValue, !value && styles.placeholder]}>{display}</Text>
        </View>
        <Text style={styles.fieldIcon}>{mode === "date" ? "▣" : "◷"}</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.panel}>
            <View style={styles.header}>
              <View><Text style={styles.eyebrow}>{mode === "date" ? "CALENDAR" : "TIME"}</Text><Text style={styles.title}>{label}</Text></View>
              <TouchableOpacity style={styles.close} onPress={() => setOpen(false)} accessibilityLabel="Close date and time picker"><Text style={styles.closeText}>×</Text></TouchableOpacity>
            </View>
            {mode === "date" ? (
              <>
                <View style={styles.monthHeader}>
                  <TouchableOpacity style={styles.monthButton} onPress={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><Text style={styles.monthButtonText}>‹</Text></TouchableOpacity>
                  <Text style={styles.monthTitle}>{visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</Text>
                  <TouchableOpacity style={styles.monthButton} onPress={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><Text style={styles.monthButtonText}>›</Text></TouchableOpacity>
                </View>
                <View style={styles.weekRow}>{weekdays.map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}</View>
                <View style={styles.calendarGrid}>
                  {calendarCells.map((date, index) => {
                    if (!date) return <View key={`blank-${index}`} style={styles.dayCell} />;
                    const iso = localIso(date);
                    const disabled = Boolean((minimumDate && iso < minimumDate) || (maximumDate && iso > maximumDate));
                    const selected = iso === value;
                    return <TouchableOpacity key={iso} style={[styles.dayCell, selected && styles.daySelected]} disabled={disabled} onPress={() => { onChange(iso); setOpen(false); }}><Text style={[styles.dayText, disabled && styles.dayDisabled, selected && styles.daySelectedText]}>{date.getDate()}</Text></TouchableOpacity>;
                  })}
                </View>
              </>
            ) : (
              <ScrollView style={styles.timeScroll} contentContainerStyle={styles.timeGrid} showsVerticalScrollIndicator={false}>
                {timeOptions.map((option) => <TouchableOpacity key={option} style={[styles.timeOption, value === option && styles.timeSelected]} onPress={() => { onChange(option); setOpen(false); }}><Text style={[styles.timeText, value === option && styles.timeSelectedText]}>{option}</Text></TouchableOpacity>)}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: { minHeight: 58, borderRadius: theme.radius.md, backgroundColor: theme.colors.panel2, paddingHorizontal: 14, paddingVertical: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  fieldCopy: { flex: 1, gap: 3 },
  fieldLabel: { color: theme.colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
  fieldValue: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
  placeholder: { color: theme.colors.muted, fontWeight: "500" },
  fieldIcon: { color: theme.colors.blue, fontSize: 22 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.82)", alignItems: "center", justifyContent: "center", padding: 16 },
  panel: { width: "100%", maxWidth: 430, maxHeight: "84%", borderRadius: 24, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, padding: 16, gap: 14 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: theme.colors.blue, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: "800", marginTop: 2 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  closeText: { color: theme.colors.text, fontSize: 25, lineHeight: 27 },
  monthHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthButton: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: theme.colors.line, alignItems: "center", justifyContent: "center" },
  monthButtonText: { color: theme.colors.text, fontSize: 27, lineHeight: 29 },
  monthTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "800" },
  weekRow: { flexDirection: "row" },
  weekday: { width: "14.285%", textAlign: "center", color: theme.colors.muted, fontSize: 10, fontWeight: "800" },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: "14.285%", aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 999 },
  dayText: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  dayDisabled: { color: "#4b5563" },
  daySelected: { backgroundColor: theme.colors.blue },
  daySelectedText: { color: "#fff", fontWeight: "900" },
  timeScroll: { maxHeight: 470 },
  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 4 },
  timeOption: { width: "31%", minHeight: 42, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.line, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.panel2 },
  timeText: { color: theme.colors.soft, fontSize: 13, fontWeight: "700" },
  timeSelected: { backgroundColor: theme.colors.blue, borderColor: theme.colors.blue },
  timeSelectedText: { color: "#fff", fontWeight: "900" },
});
