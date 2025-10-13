
// src/components/admin/AnalyticsChart.tsx
'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
} from 'recharts';
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { formatBytes } from '@/lib/utils';
import { Cpu, Tower, Bug, Server, Wifi, ArrowDown, ArrowUp } from 'lucide-react';

type AnalyticsChartProps = {
  data: any[];
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="p-2 bg-card border rounded-lg shadow-lg text-xs">
        <p className="label font-bold">{`Zeit: ${label}s`}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.color }}>
            {`${p.name}: ${
                p.dataKey.toLowerCase().includes('bytes') ? formatBytes(p.value) : p.value.toFixed(2)
            }`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function AnalyticsChart({ data }: AnalyticsChartProps) {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const startTime = data[0].timestamp;
    return data.map((entry) => ({
      ...entry,
      time: ((entry.timestamp - startTime) / 1000).toFixed(1), // Time in seconds since start
    }));
  }, [data]);
  
  if (chartData.length === 0) return null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Cpu className="text-primary"/> Host Performance</CardTitle>
                <CardDescription>Frames pro Sekunde (FPS) des Hosts.</CardDescription>
            </CardHeader>
            <CardContent className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="time" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                        <YAxis domain={[0, 70]} tick={{ fontSize: 12 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="fps" name="Host FPS" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" />
                    </AreaChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
        
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Server className="text-primary"/> Spiel-Objekte</CardTitle>
                <CardDescription>Anzahl der Gegner und Türme im Spiel.</CardDescription>
            </CardHeader>
            <CardContent className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="time" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend />
                        <Bar dataKey="enemyCount" name="Gegner" stackId="a" fill="#ef4444" />
                        <Bar dataKey="towerCount" name="Türme" stackId="a" fill="#3b82f6" />
                    </BarChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
        
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Wifi className="text-primary"/> Netzwerk-Rate</CardTitle>
                <CardDescription>Gesendete und empfangene Pakete pro Sekunde.</CardDescription>
            </CardHeader>
            <CardContent className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="time" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend />
                        <Line type="monotone" dataKey="hostPacketsPerSecond" name="Host Pakete/s (tx)" stroke="#8884d8" dot={false} />
                        <Line type="monotone" dataKey="clientPacketsPerSecond" name="Client Pakete/s (rx)" stroke="#82ca9d" dot={false} />
                    </LineChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><ArrowDown className="text-primary"/> Netzwerk-Datenvolumen</CardTitle>
                <CardDescription>Gesendete und empfangene Daten pro Sekunde.</CardDescription>
            </CardHeader>
            <CardContent className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="time" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                        <YAxis tickFormatter={(val) => formatBytes(val)} tick={{ fontSize: 12 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend />
                        <Area type="monotone" dataKey="hostBytesSentPerSecond" name="Host Daten (tx)" stroke="#8884d8" fill="#8884d8" fillOpacity={0.2} />
                        <Area type="monotone" dataKey="clientBytesReceivedPerSecond" name="Client Daten (rx)" stroke="#82ca9d" fill="#82ca9d" fillOpacity={0.2} />
                    </AreaChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    </div>
  );
}
