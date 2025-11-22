export default function DashboardPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Dashboard
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Welcome to Production Analytics. Monitor your production metrics and insights.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Production Overview
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            View your production metrics and key performance indicators.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Recent Activity
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            Track recent production activities and updates.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Quick Actions
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            Access frequently used features and tools.
          </p>
        </div>
      </div>
    </div>
  );
}
