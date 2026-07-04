import { createContext, useContext, useMemo, useState, ReactNode } from "react";
import { DateScopeFilter } from "@/components/date-scope-filter";
import { createDefaultDateScope, DateScopeState, getDateScopeRange } from "@/lib/date-scope";

type Ctx = {
  scope: DateScopeState;
  setScope: (scope: DateScopeState) => void;
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
  const [scope, setScope] = useState<DateScopeState>(() => createDefaultDateScope());

  const { from, to, label } = useMemo(() => getDateScopeRange(scope), [scope]);

  const value: Ctx = { scope, setScope, from, to, label };
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function PeriodFilter() {
  const { scope, setScope } = usePeriod();
  return <DateScopeFilter value={scope} onChange={setScope} />;
}
