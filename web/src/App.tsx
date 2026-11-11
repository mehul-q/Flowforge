import { useState, useEffect } from 'react';
import axios from 'axios';

// We will store the token in state. 
// In a real app, you'd log in, but for now we just get a dev token.
const API_URL = 'http://localhost:3000';

function App() {
  const [token, setToken] = useState<string | null>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // 1. Get a token when the app loads
  useEffect(() => {
    axios.post(`${API_URL}/auth/dev-token`, { role: 'admin' })
      .then(res => setToken(res.data.token))
      .catch(err => console.error("Failed to get token", err));
  }, []);

  // 2. Fetch runs (this is a mock function since we don't have a GET /api/runs endpoint yet)
  // For now, we will just let the user create a new run and track it.
  const createRun = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/runs`, {
        workflowName: "charge-customer",
        steps: [{ name: "charge" }, { name: "email" }]
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const newRunId = res.data.runId;
      setRuns(prev => [{ id: newRunId, workflow_name: "charge-customer", status: "PENDING" }, ...prev]);
      setSelectedRun(newRunId);
    } catch (err) {
      console.error(err);
      alert("Failed to create run");
    }
    setLoading(false);
  };

  // 3. Poll the selected run every 2 seconds to update its steps
  useEffect(() => {
    if (!selectedRun || !token) return;

    const interval = setInterval(async () => {
      try {
        const res = await axios.get(`${API_URL}/api/runs/${selectedRun}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setRuns(prev => prev.map(r => r.id === selectedRun ? res.data.run : r));
        // We store the steps locally just for the UI
        setRuns((prev: any) => {
           const updated = [...prev];
           const index = updated.findIndex(r => r.id === selectedRun);
           if (index !== -1) updated[index].steps = res.data.steps;
           return updated;
        });
      } catch (err) {
        console.error("Failed to fetch run", err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [selectedRun, token]);

  const activeRun = runs.find(r => r.id === selectedRun);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8 font-sans">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-blue-400">FlowForge</h1>
            <p className="text-gray-400">Distributed Workflow Engine</p>
          </div>
          <button 
            onClick={createRun} 
            disabled={loading || !token}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-6 py-2 rounded-lg font-medium transition-colors"
          >
            {loading ? 'Creating...' : '+ Create Test Workflow'}
          </button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left Column: Runs List */}
          <div className="bg-gray-800 rounded-xl p-4 shadow-lg col-span-1">
            <h2 className="text-lg font-semibold mb-4 border-b border-gray-700 pb-2">Runs</h2>
            {runs.length === 0 ? (
              <p className="text-gray-500 text-sm">No runs yet. Click the button above.</p>
            ) : (
              <ul className="space-y-2">
                {runs.map(run => (
                  <li 
                    key={run.id} 
                    onClick={() => setSelectedRun(run.id)}
                    className={`p-3 rounded-lg cursor-pointer transition-colors text-sm ${selectedRun === run.id ? 'bg-blue-900 border-l-4 border-blue-500' : 'bg-gray-700 hover:bg-gray-600'}`}
                  >
                    <div className="font-mono text-xs text-gray-400 truncate">{run.id}</div>
                    <div className="flex justify-between mt-1">
                      <span>{run.workflow_name}</span>
                      <span className="text-yellow-400">{run.status}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Right Column: Run Details */}
          <div className="bg-gray-800 rounded-xl p-6 shadow-lg col-span-2">
            <h2 className="text-lg font-semibold mb-4 border-b border-gray-700 pb-2">Run Details</h2>
            {!activeRun ? (
              <div className="h-64 flex items-center justify-center text-gray-500">
                Select a run to see details
              </div>
            ) : (
              <div>
                <div className="mb-6 grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-gray-400">Run ID:</span> <span className="font-mono text-xs">{activeRun.id}</span></div>
                  <div><span className="text-gray-400">Workflow:</span> {activeRun.workflow_name}</div>
                </div>

                <h3 className="text-md font-semibold mb-3">Steps</h3>
                <div className="space-y-3">
                  {activeRun.steps?.map((step: any, idx: number) => (
                    <div key={step.id} className="flex items-center justify-between bg-gray-700 p-4 rounded-lg">
                      <div className="flex items-center space-x-4">
                        <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-sm">
                          {idx + 1}
                        </div>
                        <div>
                          <div className="font-medium">{step.name}</div>
                          <div className="text-xs text-gray-400">Attempts: {step.attempt_count}</div>
                        </div>
                      </div>
                      <div>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                          step.status === 'SUCCEEDED' ? 'bg-green-900 text-green-300' : 
                          step.status === 'RUNNING' ? 'bg-blue-900 text-blue-300 animate-pulse' : 
                          step.status === 'FAILED' ? 'bg-red-900 text-red-300' : 
                          'bg-gray-600 text-gray-300'
                        }`}>
                          {step.status}
                        </span>
                      </div>
                    </div>
                  ))}
                  {!activeRun.steps && <p className="text-gray-500">Loading steps...</p>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;