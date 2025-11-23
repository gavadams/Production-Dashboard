"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
          <div className="max-w-2xl w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-8">
            <div className="flex items-center gap-3 mb-6">
              <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Something went wrong
              </h1>
            </div>

            <div className="mb-6">
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                We encountered an unexpected error. Please try refreshing the page or return to the
                dashboard.
              </p>

              {this.state.error && (
                <details className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                  <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Error Details
                  </summary>
                  <div className="mt-2 space-y-2">
                    <p className="text-sm text-red-600 dark:text-red-400 font-mono">
                      {this.state.error.message}
                    </p>
                    {this.state.errorInfo && (
                      <pre className="text-xs text-gray-600 dark:text-gray-400 overflow-auto max-h-48 p-2 bg-gray-100 dark:bg-gray-800 rounded">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    )}
                  </div>
                </details>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={this.handleReset}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Try Again
              </button>
              <Link
                href="/"
                className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
              >
                <Home className="h-4 w-4" />
                Go to Dashboard
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

