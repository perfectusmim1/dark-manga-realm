import React from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface HeatMapProps {
  data: { date: string; count: number }[];
  days?: number; // default 365
}

const HeatMap: React.FC<HeatMapProps> = ({ data, days = 365 }) => {
  // Generate the last 365 days
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const dates = [];
  for (let i = days; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d);
  }

  // Create lookup map
  const countMap = data.reduce((acc, curr) => {
    acc[curr.date] = curr.count;
    return acc;
  }, {} as Record<string, number>);

  // Determine intensity colors
  const getColor = (count: number) => {
    if (count === 0) return 'bg-secondary/40 border border-border/10';
    if (count < 3) return 'bg-primary/30';
    if (count < 10) return 'bg-primary/60';
    if (count < 20) return 'bg-primary/80';
    return 'bg-primary shadow-[0_0_8px_rgba(59,130,246,0.6)]';
  };

  // Weeks layout: group by 7 days
  const weeks = [];
  let currentWeek = [];
  
  // Pad the first week to align exactly to Sunday/Monday depending on your locale
  // For simplicity, we just chunk by 7
  for (let i = 0; i < dates.length; i++) {
    currentWeek.push(dates[i]);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);

  return (
    <div className="w-full overflow-x-auto pb-4 custom-scrollbar">
      <div className="min-w-max flex gap-1">
        {weeks.map((week, wIndex) => (
          <div key={wIndex} className="flex flex-col gap-1">
            {week.map((date, dIndex) => {
              const dateStr = date.toISOString().split('T')[0];
              const count = countMap[dateStr] || 0;
              
              return (
                <TooltipProvider key={dateStr}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div 
                        className={`w-3.5 h-3.5 rounded-xs transition-colors hover:ring-1 hover:ring-primary ${getColor(count)}`}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p className="font-semibold">{count} bölüm okundu</p>
                      <p className="text-xs text-muted-foreground">
                        {date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric'})}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 mt-4 text-xs text-muted-foreground mr-2">
        <span>Az</span>
        <div className="w-3 h-3 rounded-xs bg-secondary/40 border border-border/10" />
        <div className="w-3 h-3 rounded-xs bg-primary/30" />
        <div className="w-3 h-3 rounded-xs bg-primary/60" />
        <div className="w-3 h-3 rounded-xs bg-primary/80" />
        <div className="w-3 h-3 rounded-xs bg-primary" />
        <span>Çok</span>
      </div>
    </div>
  );
};

export default HeatMap;
