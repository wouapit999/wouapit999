"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, PieChart, Pie, Cell } from "recharts";

const C = { billed: "#94a3b8", collected: "var(--brand)", occupancy: "#0f766e" };
const PALETTE = ["#1d4ed8", "#0f766e", "#b45309", "#7c3aed", "#be123c", "#475569", "#15803d"];

function compact(n: number) {
  return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function BilledCollectedChart({ data, labels }: { data: { month: string; billed: number; collected: number }[]; labels: { billed: string; collected: string } }) {
  return (
    <div className="h-64" role="img" aria-label={`${labels.billed} / ${labels.collected}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} width={48} />
          <Tooltip formatter={(v) => Number(v).toLocaleString("fr-FR")} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="billed" name={labels.billed} fill={C.billed} radius={[3, 3, 0, 0]} />
          <Bar dataKey="collected" name={labels.collected} fill={C.collected} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SimpleBarChart({ data, label }: { data: { name: string; value: number }[]; label: string }) {
  return (
    <div className="h-56" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
          <XAxis type="number" tickFormatter={compact} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => Number(v).toLocaleString("fr-FR")} />
          <Bar dataKey="value" name={label} fill={C.collected} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OccupancyTrendChart({ data, label }: { data: { month: string; rate: number }[]; label: string }) {
  return (
    <div className="h-56" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} width={40} />
          <Tooltip formatter={(v) => `${v}%`} />
          <Line type="monotone" dataKey="rate" name={label} stroke={C.occupancy} strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutChart({ data, label }: { data: { name: string; value: number }[]; label: string }) {
  return (
    <div className="h-56" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => Number(v).toLocaleString("fr-FR")} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
