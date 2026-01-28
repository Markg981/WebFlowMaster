import { useState } from 'react';
import { useToast } from "@/components/ui/use-toast";

export interface ExcelTestCase {
  id: string; // row ID or internal
  testCaseId: string;
  priority: string;
  functionalObjective: string;
  expectedOutcome: string;
  devOpsId: string;
  sme: string;
}

export function useExcelImport() {
  const [file, setFile] = useState<File | null>(null);
  const [parsedTestCases, setParsedTestCases] = useState<ExcelTestCase[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await fetch('/api/upload-excel', {
        method: 'POST',
        body: formData, 
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setParsedTestCases(data);
      toast({ title: "Success", description: `Parsed ${data.length} test cases.` });
    } catch (error) {
       toast({ title: "Error", description: "Failed to upload/parse file", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  return { 
    file, 
    parsedTestCases, 
    isUploading, 
    handleFileChange, 
    handleUpload 
  };
}
