"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, X, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { validateFileName, getValidPressCodes } from "@/lib/fileValidation";
import { parseProductionReport } from "@/lib/excelParser";
import {
  checkExistingUpload,
  insertUploadHistory,
  saveProductionData,
} from "@/lib/database";

interface FileWithValidation {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  isValid?: boolean;
  validationError?: string;
  // Preserve File object methods
  arrayBuffer: () => Promise<ArrayBuffer>;
  stream: () => ReadableStream<Uint8Array>;
  text: () => Promise<string>;
  slice: (start?: number, end?: number, contentType?: string) => Blob;
}

interface ProcessingResult {
  filename: string;
  success: boolean;
  message: string;
  recordsCreated?: {
    productionRuns: number;
    downtimeEvents: number;
    spoilageEvents: number;
  };
  error?: string;
}

function formatFileSize(bytes: number | undefined): string {
  if (!bytes || bytes === 0 || isNaN(bytes)) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
}

export default function UploadPage() {
  const [files, setFiles] = useState<FileWithValidation[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingResults, setProcessingResults] = useState<ProcessingResult[]>([]);
  const [currentProcessingFile, setCurrentProcessingFile] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const validatedFiles: FileWithValidation[] = acceptedFiles.map((file) => {
      const validation = validateFileName(file.name);
      // Preserve the File object and add validation properties
      return {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        isValid: validation.isValid,
        validationError: validation.error,
        arrayBuffer: file.arrayBuffer.bind(file),
        stream: file.stream.bind(file),
        text: file.text.bind(file),
        slice: file.slice.bind(file),
      } as FileWithValidation;
    });

    setFiles((prevFiles) => [...prevFiles, ...validatedFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
    multiple: true,
  });

  const removeFile = (index: number) => {
    setFiles((prevFiles) => prevFiles.filter((_, i) => i !== index));
  };

  const clearAllFiles = () => {
    setFiles([]);
  };

  const handleProcessFiles = async () => {
    const validFiles = files.filter((file) => file.isValid);
    if (validFiles.length === 0) {
      alert("Please add at least one valid file to process.");
      return;
    }

    setIsProcessing(true);
    setProcessingResults([]);
    const results: ProcessingResult[] = [];

    for (const fileWithValidation of validFiles) {
      const filename = fileWithValidation.name;
      setCurrentProcessingFile(filename);

      try {
        // Step 1: Parse the production report
        const file = new File(
          [await fileWithValidation.arrayBuffer()],
          filename,
          { type: fileWithValidation.type }
        );

        const report = await parseProductionReport(file, filename);

        if (!report) {
          results.push({
            filename,
            success: false,
            message: "Failed to parse production report",
            error: "Parsing returned null",
          });
          continue;
        }

        // Step 2: Check for existing upload
        const existing = await checkExistingUpload(report.press, report.date);

        if (existing) {
          const shouldProceed = window.confirm(
            `An upload already exists for ${report.press} on ${report.date}.\n\n` +
            `Previously uploaded: ${new Date(existing.uploaded_at).toLocaleString()}\n` +
            `File: ${existing.filename}\n\n` +
            `Do you want to proceed? This will create duplicate records.`
          );

          if (!shouldProceed) {
            results.push({
              filename,
              success: false,
              message: "Upload cancelled by user",
              error: "User declined to overwrite existing data",
            });
            continue;
          }
        }

        // Step 3: Create upload history record
        const uploadHistory = await insertUploadHistory({
          filename,
          press: report.press,
          date: report.date,
          file_size: fileWithValidation.size,
          status: "processing",
        });

        if (!uploadHistory) {
          results.push({
            filename,
            success: false,
            message: "Failed to create upload history record",
            error: "Could not insert upload history",
          });
          continue;
        }

        // Step 4: Save production data
        const saveResult = await saveProductionData(report, uploadHistory.id);

        if (!saveResult.success) {
          // Update upload history with error status
          await insertUploadHistory({
            filename,
            press: report.press,
            date: report.date,
            file_size: fileWithValidation.size,
            status: "failed",
            error_message: saveResult.errors.join("; "),
          });

          results.push({
            filename,
            success: false,
            message: "Failed to save production data",
            error: saveResult.errors.join("; "),
            recordsCreated: saveResult.recordsCreated,
          });
          continue;
        }

        // Step 5: Update upload history with success
        await insertUploadHistory({
          filename,
          press: report.press,
          date: report.date,
          file_size: fileWithValidation.size,
          status: "completed",
        });

        results.push({
          filename,
          success: true,
          message: "Successfully processed and saved",
          recordsCreated: saveResult.recordsCreated,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        results.push({
          filename,
          success: false,
          message: "Error processing file",
          error: errorMessage,
        });
      }
    }

    setProcessingResults(results);
    setCurrentProcessingFile(null);
    setIsProcessing(false);
  };

  const validFilesCount = files.filter((f) => f.isValid).length;
  const invalidFilesCount = files.filter((f) => !f.isValid).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Upload Data</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Upload production data files. Files must match the pattern:{" "}
          <code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-sm">
            {"857{PRESS}_{DD-MMM-YYYY}.xlsx"}
          </code>
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
          Valid press codes: {getValidPressCodes().join(", ")}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
          Example: <code className="bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded">857LP05_06-Nov-2025.xlsx</code>
        </p>
      </div>

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors
          ${
            isDragActive
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
              : "border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 hover:border-gray-400 dark:hover:border-gray-500"
          }
        `}
      >
        <input {...getInputProps()} />
        <Upload
          className={`mx-auto h-12 w-12 mb-4 ${
            isDragActive
              ? "text-blue-500"
              : "text-gray-400 dark:text-gray-500"
          }`}
        />
        {isDragActive ? (
          <p className="text-lg font-medium text-blue-600 dark:text-blue-400">
            Drop the files here...
          </p>
        ) : (
          <>
            <p className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">
              Drag and drop .xlsx files here, or click to select
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Only .xlsx files are accepted
            </p>
          </>
        )}
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="mt-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Selected Files ({files.length})
            </h2>
            <button
              onClick={clearAllFiles}
              className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium"
            >
              Clear All
            </button>
          </div>

          <div className="space-y-3">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className={`
                  flex items-center justify-between p-4 rounded-lg border
                  ${
                    file.isValid
                      ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                      : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                  }
                `}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <FileSpreadsheet
                    className={`h-5 w-5 flex-shrink-0 ${
                      file.isValid
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900 dark:text-white truncate">
                        {file.name || "Unknown file"}
                      </p>
                      {file.isValid ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {formatFileSize(file.size)}
                    </p>
                    {!file.isValid && file.validationError && (
                      <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                        {file.validationError}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => removeFile(index)}
                  className="ml-4 p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors flex-shrink-0"
                  aria-label="Remove file"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            ))}
          </div>

          {/* Summary and Process Button */}
          <div className="mt-6 flex flex-col sm:flex-row justify-between items-center gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              <span className="font-medium text-green-600 dark:text-green-400">
                {validFilesCount} valid
              </span>
              {invalidFilesCount > 0 && (
                <>
                  {" • "}
                  <span className="font-medium text-red-600 dark:text-red-400">
                    {invalidFilesCount} invalid
                  </span>
                </>
              )}
            </div>
            <button
              onClick={handleProcessFiles}
              disabled={validFilesCount === 0 || isProcessing}
              className={`
                px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2
                ${
                  validFilesCount > 0 && !isProcessing
                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                    : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                }
              `}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                `Process Files (${validFilesCount})`
              )}
            </button>
          </div>
        </div>
      )}

      {/* Processing Status */}
      {isProcessing && currentProcessingFile && (
        <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin" />
            <div>
              <p className="font-medium text-blue-900 dark:text-blue-100">
                Processing: {currentProcessingFile}
              </p>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Please wait while we parse and save the data...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Processing Results */}
      {processingResults.length > 0 && !isProcessing && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Processing Results
          </h2>

          <div className="space-y-3">
            {processingResults.map((result, index) => (
              <div
                key={`${result.filename}-${index}`}
                className={`
                  p-4 rounded-lg border
                  ${
                    result.success
                      ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                      : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                  }
                `}
              >
                <div className="flex items-start gap-3">
                  {result.success ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-gray-900 dark:text-white">
                        {result.filename}
                      </p>
                    </div>
                    <p
                      className={`text-sm ${
                        result.success
                          ? "text-green-700 dark:text-green-300"
                          : "text-red-700 dark:text-red-300"
                      }`}
                    >
                      {result.message}
                    </p>
                    {result.recordsCreated && (
                      <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                        <p>
                          Production Runs: {result.recordsCreated.productionRuns} • Downtime
                          Events: {result.recordsCreated.downtimeEvents} • Spoilage Events:{" "}
                          {result.recordsCreated.spoilageEvents}
                        </p>
                      </div>
                    )}
                    {result.error && (
                      <details className="mt-2">
                        <summary className="text-sm text-red-600 dark:text-red-400 cursor-pointer hover:underline">
                          Show error details
                        </summary>
                        <pre className="mt-2 text-xs text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30 p-2 rounded overflow-auto">
                          {result.error}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Summary</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-600 dark:text-gray-400">Total Files: </span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {processingResults.length}
                </span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Successful: </span>
                <span className="font-medium text-green-600 dark:text-green-400">
                  {processingResults.filter((r) => r.success).length}
                </span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Failed: </span>
                <span className="font-medium text-red-600 dark:text-red-400">
                  {processingResults.filter((r) => !r.success).length}
                </span>
              </div>
            </div>
            {processingResults.some((r) => r.success && r.recordsCreated) && (
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <h4 className="font-medium text-gray-900 dark:text-white mb-2">
                  Total Records Created
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Production Runs: </span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {processingResults.reduce(
                        (sum, r) => sum + (r.recordsCreated?.productionRuns || 0),
                        0
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Downtime Events: </span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {processingResults.reduce(
                        (sum, r) => sum + (r.recordsCreated?.downtimeEvents || 0),
                        0
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Spoilage Events: </span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {processingResults.reduce(
                        (sum, r) => sum + (r.recordsCreated?.spoilageEvents || 0),
                        0
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
