import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, MonitorSmartphone, CalendarDays, FileText, Play, Search, RefreshCcw, ChevronLeft, ChevronRight } from 'lucide-react';

interface TestPlanItem {
  id: string;
  name: string;
  project: string;
}

const mockTestPlans: TestPlanItem[] = [
  { id: '1', name: 'Test Suite Alpha', project: 'Progetto Apollo' },
  { id: '2', name: 'User Authentication Flow', project: 'Progetto Zeus' },
  { id: '3', name: 'Payment Gateway Integration', project: 'Progetto Hera' },
];

const TestSuitesPage: React.FC = () => {
  return (
    <div className="container mx-auto py-8">
      {/* Header START */}
      <div className="flex justify-between items-center mb-4">
        <div></div> {/* Placeholder for potential future left-aligned header content */}
        <Button className="bg-green-500 hover:bg-green-600 text-white">
          + Test Plan
        </Button>
      </div>
      {/* Header END */}

      <Tabs defaultValue="test-plan">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="test-plan">Test Plan</TabsTrigger>
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
        </TabsList>
        <TabsContent value="test-plan" className="mt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Test Lab Type</TableHead>
                <TableHead>Progetto di appartenenza</TableHead>
                <TableHead>Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedTestPlans.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div>{item.name}</div>
                    <div className="text-xs text-muted-foreground">No Description</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-1">
                      <Settings size={16} />
                      <MonitorSmartphone size={16} />
                      <span>Cross Device Testing</span>
                    </div>
                  </TableCell>
                  <TableCell>{item.project}</TableCell>
                  <TableCell>
                    <div className="space-x-2">
                      <Button variant="outline" size="sm">
                        <CalendarDays size={16} className="mr-1" /> Schedule
                      </Button>
                      <Button variant="outline" size="sm">
                        <FileText size={16} className="mr-1" /> Reports
                      </Button>
                      <Button variant="outline" size="sm">
                        <Play size={16} className="mr-1" /> Run
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="schedules" className="mt-6">
          {/* Content for Schedules tab will go here */}
          <p>Schedules content goes here.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default TestSuitesPage;
