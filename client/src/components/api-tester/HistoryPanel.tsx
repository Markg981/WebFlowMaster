import React from 'react';
import { ApiTestHistoryEntry } from '@shared/schema';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge'; // For displaying method

interface HistoryPanelProps {
  historyItems: ApiTestHistoryEntry[];
  onLoadHistoryItem: (item: ApiTestHistoryEntry) => void;
  onClearHistory?: () => void; // Optional: for a "Clear All" button
  isLoading?: boolean;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
  historyItems,
  onLoadHistoryItem,
  onClearHistory,
  isLoading,
}) => {
  const getStatusColor = (status?: number | null) => {
    if (status === null || status === undefined) return 'bg-gray-400';
    if (status >= 200 && status < 300) return 'bg-green-500';
    if (status >= 300 && status < 400) return 'bg-yellow-500';
    if (status >= 400 && status < 500) return 'bg-red-500';
    if (status >= 500) return 'bg-purple-500';
    return 'bg-gray-400';
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between py-3 px-4 border-b">
        <CardTitle className="text-lg">History</CardTitle>
        {onClearHistory && (
          <Button variant="outline" size="sm" onClick={onClearHistory} disabled={isLoading || historyItems.length === 0}>
            Clear All
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0 flex-1">
        <ScrollArea className="h-full p-3">
          {isLoading && <p className="text-sm text-muted-foreground">Loading history...</p>}
          {!isLoading && historyItems.length === 0 && (
            <p className="text-sm text-muted-foreground p-4 text-center">No history items yet.</p>
          )}
          <div className="space-y-2">
            {historyItems.map((item) => (
              <div
                key={item.id}
                className="p-3 border rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => onLoadHistoryItem(item)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs py-0.5 px-1.5">
                      {item.method}
                    </Badge>
                    <span className="text-xs text-muted-foreground truncate max-w-[150px] sm:max-w-[200px] md:max-w-xs" title={item.url}>
                      {item.url}
                    </span>
                  </div>
                  {item.responseStatus !== null && item.responseStatus !== undefined && (
                     <div className="flex items-center gap-1.5">
                        <span className={`w-2.5 h-2.5 rounded-full ${getStatusColor(item.responseStatus)}`}></span>
                        <span className="text-xs font-semibold">{item.responseStatus}</span>
                     </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {new Date(item.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
