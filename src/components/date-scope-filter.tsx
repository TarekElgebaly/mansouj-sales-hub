import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateScopeState, MONTHS, yearOptions } from "@/lib/date-scope";

export function DateScopeFilter({
  value,
  onChange,
  allowAllMonths = false,
}: {
  value: DateScopeState;
  onChange: (value: DateScopeState) => void;
  allowAllMonths?: boolean;
}) {
  const years = yearOptions();
  const update = (patch: Partial<DateScopeState>) => onChange({ ...value, ...patch });
  const months = allowAllMonths ? [{ value: "all", label: "All months" }, ...MONTHS] : MONTHS;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <Label className="text-xs">Date Scope</Label>
        <Select value={value.mode} onValueChange={(mode) => update({ mode: mode as DateScopeState["mode"] })}>
          <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="single_month">Single Month</SelectItem>
            <SelectItem value="custom_range">Custom Date Range</SelectItem>
            <SelectItem value="multi_month">Multi-Month Range</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value.mode === "single_month" && (
        <>
          <div>
            <Label className="text-xs">Month</Label>
            <Select value={value.month} onValueChange={(month) => update({ month })}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map((month) => (
                  <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Year</Label>
            <Select value={value.year} onValueChange={(year) => update({ year })}>
              <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {value.mode === "custom_range" && (
        <>
          <div>
            <Label className="text-xs">Start Date</Label>
            <Input
              type="date"
              className="h-9 w-40"
              value={value.startDate}
              onChange={(event) => update({ startDate: event.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">End Date</Label>
            <Input
              type="date"
              className="h-9 w-40"
              value={value.endDate}
              onChange={(event) => update({ endDate: event.target.value })}
            />
          </div>
        </>
      )}

      {value.mode === "multi_month" && (
        <>
          <div>
            <Label className="text-xs">Start Month</Label>
            <Select value={value.startMonth} onValueChange={(startMonth) => update({ startMonth })}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((month) => (
                  <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Start Year</Label>
            <Select value={value.startYear} onValueChange={(startYear) => update({ startYear })}>
              <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">End Month</Label>
            <Select value={value.endMonth} onValueChange={(endMonth) => update({ endMonth })}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((month) => (
                  <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">End Year</Label>
            <Select value={value.endYear} onValueChange={(endYear) => update({ endYear })}>
              <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}
    </div>
  );
}
