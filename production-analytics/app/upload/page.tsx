"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, X, FileSpreadsheet, CheckCircle2, AlertCircle } from "lucide-react";
import { validateFileName, getValidPressCodes } from "@/lib/fileValidation";

interface FileWithValidation extends File {
  isValid?: boolean;
  validationError?: string;
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

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const validatedFiles: FileWithValidation[] = acceptedFiles.map((file) => {
      const validation = validateFileName(file.name);
      return {
        ...file,
        isValid: validation.isValid,
        validationError: validation.error,
      };
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

  const handleProcessFiles = () => {
    const validFiles = files.filter((file) => file.isValid);
    if (validFiles.length === 0) {
      alert("Please add at least one valid file to process.");
      return;
    }
    // TODO: Implement file processing logic
    console.log("Processing files:", validFiles);
    alert(`Processing ${validFiles.length} file(s)...`);
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
              disabled={validFilesCount === 0}
              className={`
                px-6 py-2 rounded-lg font-medium transition-colors
                ${
                  validFilesCount > 0
                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                    : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                }
              `}
            >
              Process Files ({validFilesCount})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
