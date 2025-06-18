import React, { useState, useMemo } from 'react';
import { Link } from 'wouter';
// Removed Tabs, TabsContent, TabsList, TabsTrigger
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
// Removed Select, SelectContent, SelectItem, SelectTrigger, SelectValue
import { CalendarDays, FileText, Play, Search, RefreshCcw, ChevronLeft, ChevronRight, ArrowLeft, PlusCircle, MoreVertical, Trash2, Copy, Edit3 } from 'lucide-react'; // Added PlusCircle, MoreVertical, Trash2, Copy, Edit3. Removed LibrarySquare, Settings, MonitorSmartphone
import { Badge } from '@/components/ui/badge'; // Added Badge for status
import { Card } from '@/components/ui/card'; // Added Card for table container
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'; // Added DropdownMenu components

interface TestItem {
  id: string;
  name: string;
  type: string;
  status: 'Pass' | 'Fail' | 'Pending' | 'Running';
  lastRun: string;
}

const mockTests: TestItem[] = [
  { id: '1', name: 'Login API Test', type: 'API Test', status: 'Pass', lastRun: '2023-10-26' },
  { id: '2', name: 'Homepage UI Load', type: 'UI Test', status: 'Fail', lastRun: '2023-10-25' },
  { id: '3', name: 'Payment Process', type: 'E2E Test', status: 'Pass', lastRun: '2023-10-26' },
  { id: '4', name: 'User Profile Update API', type: 'API Test', status: 'Pending', lastRun: 'N/A' },
  { id: '5', name: 'Product Search Performance', type: 'Performance Test', status: 'Running', lastRun: '2023-10-27' },
];

const TestsPage: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  // Removed selectedProject state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10; // Changed items per page

  // Removed projectOptions

  const filteredTests = useMemo(() => {
    return mockTests.filter(test => {
      const nameMatch = test.name.toLowerCase().includes(searchTerm.toLowerCase());
      const typeMatch = test.type.toLowerCase().includes(searchTerm.toLowerCase());
      // Removed projectMatch, searching in name or type
      return nameMatch || typeMatch;
    });
  }, [searchTerm]); // Removed selectedProject from dependencies

  const totalPages = Math.ceil(filteredTests.length / itemsPerPage);
  const paginatedTests = filteredTests.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const getStatusBadgeVariant = (status: TestItem['status']) => {
    switch (status) {
      case 'Pass': return 'default'; // Greenish in shadcn/ui
      case 'Fail': return 'destructive'; // Reddish
      case 'Pending': return 'secondary'; // Greyish
      case 'Running': return 'outline'; // Blueish or distinct outline
      default: return 'secondary';
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Link href="/dashboard" className="flex items-center space-x-2 text-primary hover:underline">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <FileText className="h-6 w-6 text-primary" /> {/* Changed Icon */}
            <h1 className="text-xl font-bold text-card-foreground">Tests</h1> {/* Changed Title */}
          </div>
          <div className="flex items-center space-x-2"> {/* Changed for + Test button */}
            <Link href="/dashboard/create-test"> {/* Changed Link destination */}
              <Button variant="outline" className="bg-green-500 hover:bg-green-600 text-white"> {/* Changed button style to match previous + Test Plan */}
                <PlusCircle className="w-4 h-4 mr-2" />
                + Test {/* Changed Button Text */}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="p-6 flex-1 overflow-auto">
        <div className="flex flex-col md:flex-row justify-between items-center mb-6 space-y-4 md:space-y-0">
          <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto">
            <div className="relative w-full sm:w-auto">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search tests..." /* Changed placeholder */
                className="pl-8 pr-2 py-2 h-10 w-full sm:w-[200px] lg:w-[250px]" // Retained class for consistency
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              />
            </div>
            {/* Removed Project Select Dropdown */}
            <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => { setSearchTerm(''); setCurrentPage(1); }}> {/* Removed setSelectedProject */}
              <RefreshCcw size={18} />
            </Button>
          </div>

          {/* Right part: Pagination - Button moved to header */}
          <div className="flex items-center gap-2">
            <div className="flex items-center text-sm font-medium">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft size={16} />
              </Button>
              <span className="mx-2">
                {/* Updated to use filteredTests */}
                {`${Math.min((currentPage - 1) * itemsPerPage + 1, filteredTests.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1)}-${Math.min(currentPage * itemsPerPage, filteredTests.length)} of ${filteredTests.length}`}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages || filteredTests.length === 0}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>
        </div>

        {/* Removed Tabs defaultValue, TabsList, TabsTrigger and TabsContent wrapper. Table is now directly under controls. */}
        <Card> {/* Added Card wrapper for consistent styling */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead> {/* New Header */}
                <TableHead>Status</TableHead> {/* New Header */}
                <TableHead>Last Run</TableHead> {/* New Header */}
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedTests.map((item) => ( /* Changed to paginatedTests */
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-medium">{item.name}</div> {/* Display item.name */}
                    {/* Removed description part */}
                  </TableCell>
                  <TableCell>{item.type}</TableCell> {/* Display item.type */}
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(item.status)}> {/* Display item.status with Badge */}
                      {item.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{item.lastRun}</TableCell> {/* Display item.lastRun */}
                  <TableCell>
                    <div className="flex items-center space-x-2"> {/* Kept flex for button alignment */}
                      <Button variant="ghost" size="icon" title="Run"> {/* Changed to ghost variant, icon size */}
                        <Play className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Schedule"> {/* Changed to ghost variant, icon size */}
                        <CalendarDays className="w-4 h-4" /> {/* Corrected icon name */}
                      </Button>
                      <Button variant="ghost" size="icon" title="Reports"> {/* Changed to ghost variant, icon size */}
                        <FileText className="w-4 h-4" /> {/* Corrected icon name */}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>
                            <Edit3 className="w-4 h-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Copy className="w-4 h-4 mr-2" />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600">
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        {/* Removed TabsContent for schedules */}
      </div>
    </div>
  );
};

export default TestsPage; // Changed export name
