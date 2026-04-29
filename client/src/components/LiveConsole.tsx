import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface LiveConsoleProps {
  logs: string[];
}

export const LiveConsole: React.FC<LiveConsoleProps> = ({ logs }) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // simple parser to highlight errors or success
  const renderLogLine = (log: string) => {
    if (log.includes('FAILED') || log.includes('Error') || log.toLowerCase().includes('fail')) {
      return <span className="text-destructive font-semibold">{log}</span>;
    }
    if (log.includes('PASSED') || log.includes('Success') || log.toLowerCase().includes('pass')) {
      return <span className="text-success font-semibold">{log}</span>;
    }
    return <span className="text-foreground/80">{log}</span>;
  };

  if (logs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950 p-4 rounded-b-md border border-white/5 font-mono text-xs text-muted-foreground">
        In attesa di log...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-950 p-4 rounded-b-md border border-white/5 shadow-inner font-mono text-xs">
      <AnimatePresence>
        {logs.map((log, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
            className="mb-1.5 leading-relaxed flex"
          >
            <span className="text-blue-500/70 mr-3 select-none flex-shrink-0">
              $
            </span>
            <div className="flex-1 break-words">
              {renderLogLine(log)}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      <div ref={endRef} />
    </div>
  );
};
