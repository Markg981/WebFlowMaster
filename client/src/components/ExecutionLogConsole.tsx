import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Terminal, Filter, Pause, Play, Download, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface LogEntry {
  id?: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'step' | 'debug';
  source: string;
  message: string;
  metadata?: any;
}

interface ExecutionLogConsoleProps {
  executionId: string;
}

const LEVEL_COLORS: Record<string, string> = {
  error: 'text-red-400',
  warn: 'text-yellow-400',
  info: 'text-blue-400',
  step: 'text-green-400',
  debug: 'text-gray-500',
};

const SOURCE_COLORS: Record<string, string> = {
  playwright: 'text-purple-400',
  'api-runner': 'text-cyan-400',
  system: 'text-orange-400',
  worker: 'text-indigo-400',
};

export function ExecutionLogConsole({ executionId }: ExecutionLogConsoleProps) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeLevels, setActiveLevels] = useState<Set<string>>(new Set(['info', 'warn', 'error', 'step']));
  const [autoScroll, setAutoScroll] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  const parentRef = useRef<HTMLDivElement>(null);

  // Fetch historical logs
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setIsLoading(true);
        const res = await fetch(`/api/test-plan-executions/${executionId}/logs`);
        if (res.ok) {
          const data = await res.json();
          setLogs(data);
        }
      } catch (error) {
        console.error('Failed to fetch logs:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (executionId) {
      fetchLogs();
    }
  }, [executionId]);

  // WebSocket for live updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'subscribe-execution',
        executionId
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'execution-log' && msg.executionId === executionId) {
          setLogs(prev => [...prev, msg]);
        }
      } catch (e) {
        // ignore
      }
    };

    return () => ws.close();
  }, [executionId]);

  // Filtering
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesLevel = activeLevels.has(log.level);
      const matchesSearch = searchQuery === '' || 
        log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.source.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesLevel && matchesSearch;
    });
  }, [logs, activeLevels, searchQuery]);

  // Virtualization
  const virtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24, // Estimate height of a single log line
    overscan: 20,
  });

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && filteredLogs.length > 0) {
      virtualizer.scrollToIndex(filteredLogs.length - 1, { align: 'end' });
    }
  }, [filteredLogs.length, autoScroll, virtualizer]);

  const toggleLevel = (level: string) => {
    const next = new Set(activeLevels);
    if (next.has(level)) {
      next.delete(level);
    } else {
      next.add(level);
    }
    setActiveLevels(next);
  };

  const downloadLogs = () => {
    const content = JSON.stringify(logs, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `execution-${executionId}-logs.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden font-mono text-xs">
      {/* Header / Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-zinc-400">
            <Terminal className="h-4 w-4" />
            <span className="font-semibold uppercase tracking-wider">Console</span>
          </div>
          <Separator orientation="vertical" className="h-4 bg-zinc-700" />
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500" />
            <Input 
              placeholder="Search logs..." 
              className="h-7 w-48 pl-7 bg-zinc-800 border-zinc-700 text-zinc-200 focus-visible:ring-zinc-600 text-[10px]"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
                <Filter className="h-3 w-3 mr-2" />
                Levels
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800 text-zinc-300">
              {['info', 'warn', 'error', 'step', 'debug'].map(level => (
                <DropdownMenuCheckboxItem
                  key={level}
                  checked={activeLevels.has(level)}
                  onCheckedChange={() => toggleLevel(level)}
                  className="capitalize focus:bg-zinc-800 focus:text-zinc-100"
                >
                  {level}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button 
            variant="ghost" 
            size="sm" 
            className={`h-7 px-2 ${autoScroll ? 'text-blue-400' : 'text-zinc-500'} hover:bg-zinc-800`}
            onClick={() => setAutoScroll(!autoScroll)}
          >
            {autoScroll ? <Pause className="h-3 w-3 mr-2" /> : <Play className="h-3 w-3 mr-2" />}
            {autoScroll ? 'Auto-scroll' : 'Paused'}
          </Button>

          <Button variant="ghost" size="sm" className="h-7 px-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" onClick={downloadLogs}>
            <Download className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Log area */}
      <div 
        ref={parentRef} 
        className="flex-1 overflow-auto p-2 scrollbar-thin scrollbar-thumb-zinc-800"
        onWheel={() => setAutoScroll(false)}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-zinc-500 italic">
            Loading logs...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-600 italic">
            No logs to display
          </div>
        ) : (
          <motion.div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const log = filteredLogs[virtualRow.index];
              const time = new Date(log.timestamp).toLocaleTimeString('en-GB', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });
              const ms = new Date(log.timestamp).getMilliseconds().toString().padStart(3, '0');

              return (
                <motion.div
                  key={virtualRow.key}
                  className="absolute top-0 left-0 w-full flex gap-3 px-2 py-0.5 hover:bg-zinc-900/50 group whitespace-nowrap overflow-hidden"
                  style={{
                    height: virtualRow.size,
                    y: virtualRow.start,
                  }}
                >
                  <span className="text-zinc-600 shrink-0 select-none">
                    {time}.{ms}
                  </span>
                  <span className={`w-10 uppercase font-bold shrink-0 select-none ${LEVEL_COLORS[log.level] || 'text-zinc-400'}`}>
                    {log.level}
                  </span>
                  <span className={`w-20 shrink-0 select-none truncate ${SOURCE_COLORS[log.source] || 'text-zinc-500'}`}>
                    [{log.source}]
                  </span>
                  <span className="text-zinc-300 group-hover:text-white transition-colors truncate">
                    {log.message}
                  </span>
                  {log.metadata && Object.keys(log.metadata).length > 0 && (
                    <span className="text-zinc-600 italic shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {JSON.stringify(log.metadata)}
                    </span>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>

      {/* Footer / Status */}
      <div className="px-3 py-1 bg-zinc-900 border-t border-zinc-800 flex justify-between items-center text-[10px] text-zinc-500">
        <div>
          Showing {filteredLogs.length} of {logs.length} logs
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="h-4 bg-zinc-800 border-zinc-700 text-zinc-400 px-1 font-normal">
            ID: {executionId}
          </Badge>
          <div className="flex items-center gap-1">
            <div className={`h-1.5 w-1.5 rounded-full ${autoScroll ? 'bg-green-500' : 'bg-zinc-600'}`} />
            {autoScroll ? 'Live' : 'Stopped'}
          </div>
        </div>
      </div>
    </div>
  );
}
