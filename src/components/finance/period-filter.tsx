import { createContext, useContext, useMemo, useState, ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Ctx = {
  month: number; // 0-11
  year: number;
  setMonth: (m: number) => void;
  setYear: (y: number) => void;
  from: string;
  to: string;
  label: string;
};

const PeriodContext = createContext<Ctx | null>(null);

export function usePeriod() {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error("usePeriod must be used within PeriodProvider");
  return ctx;
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());

  const { from, to } = useMemo(() => {
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    return { from: iso(start), to: iso(end) };
  }, [month, year]);

  const value: Ctx = { month, year, setMonth, setYear, from, to, label: `${MONTHS[month]} ${year}` };
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function PeriodFilter() {
  const { month, year, setMonth, setYear } = usePeriod();
  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = currentYear - 5; y <= currentYear + 1; y++) years.push(y);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <Label className="text-xs">Month</Label>
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={m} value={String(i)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Year</Label>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
