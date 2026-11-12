import { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:3000';

function App() {
  const [token, setToken] = useState<string | null>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Copilot state
  const [chatOpen, setChatOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: string, text: string }[]>([]);
  const [asking, setAsking] = useState(false);

  // DLQ State
  const [activeTab, setActiveTab] = useState<'dashboard' | 'dlq'>('dashboard');
  const [dlqSteps, setDlqSteps] = useState<any[]>([]);

  // 1. Get a token when the app loads
  useEffect(() => {
    axios.post(`${API_URL}/auth/dev-token`, { role: 'admin' })
      .then(res => setToken(res.data.token))
      .catch(err => console.error("Failed to get token", err));
  }, []);

  // 2. Fetch DLQ data
  const fetchDlq = async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API_URL}/api/dlq`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDlqSteps(res.data);
    } catch (err) {
      console.error("Failed to fetch DLQ", err);
    }
  };

  // 3. Retry a failed step
  const retryStep = async (id: string) => {
    try {
      await axios.post(`${API_URL}/api/dlq/${id}/retry`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchDlq(); // Refresh the DLQ list
      alert("Step re-queued! Check the dashboard.");
      setActiveTab('dashboard'); // Jump back to dashboard
    } catch (err) {
      console.error(err);
      alert("Failed to retry step");
    }
  };

  // 4. Poll DLQ every 3 seconds if we are on the DLQ tab
  useEffect(() => {
    if (activeTab !== 'dlq' || !token) return;
    fetchDlq();
    const interval = setInterval(fetchDlq, 3000);
    return () => clearInterval(interval);
  }, [activeTab, token]);

  // 5. Create a new workflow run
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
      setActiveTab('dashboard');
    } catch (err) {
      console.error(err);
      alert("Failed to create run. Check API logs.");
    }
    setLoading(false);
  };

  // 6. Poll the selected run every 2 seconds to update its steps
  useEffect(() => {
    if (!selectedRun || !token) return;

    const interval = setInterval(async () => {
      try {
        const res = await axios.get(`${API_URL}/api/runs/${selectedRun}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setRuns((prev: any) => {
          const updated = [...prev];
          const index = updated.findIndex(r => r.id === selectedRun);
          if (index !== -1) {
            updated[index] = { ...updated[index], ...res.data.run, steps: res.data.steps };
          }
          return updated;
        });
      } catch (err) {
        console.error("Failed to fetch run", err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [selectedRun, token]);

  // Manual refresh function for the dashboard
  const refreshRun = async () => {
    if (!selectedRun || !token) return;
    try {
      const res = await axios.get(`${API_URL}/api/runs/${selectedRun}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRuns((prev: any) => {
        const updated = [...prev];
        const index = updated.findIndex(r => r.id === selectedRun);
        if (index !== -1) {
          updated[index] = { ...updated[index], ...res.data.run, steps: res.data.steps };
        }
        return updated;
      });
    } catch (err) {
      console.error(err);
    }
  };

  // 7. Ask the Copilot
  const askCopilot = async () => {
    if (!question || !token) return;
    const q = question;
    setQuestion("");
    setChatHistory(prev => [...prev, { role: 'user', text: q }]);
    setAsking(true);

    try {
      const res = await axios.post(`${API_URL}/api/copilot`,
        { question: q },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setChatHistory(prev => [...prev, { role: 'ai', text: res.data.answer }]);
    } catch (err) {
      setChatHistory(prev => [...prev, { role: 'ai', text: "Error connecting to AI. Check your Groq API key." }]);
    }
    setAsking(false);
  };

  const activeRun = runs.find(r => r.id === selectedRun);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8 font-sans">
      <div className="max-w-4xl mx-auto">
        
        {/* Header */}
        <header className="flex justify-between items-center mb-4">
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

        {/* Tabs */}
        <div className="flex space-x-4 mb-6 border-b border-gray-700">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`pb-2 px-4 font-medium transition-colors ${activeTab === 'dashboard' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('dlq')}
            className={`pb-2 px-4 font-medium transition-colors flex items-center gap-2 ${activeTab === 'dlq' ? 'border-b-2 border-red-500 text-red-400' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Dead Letter Queue
            {dlqSteps.length > 0 && (
              <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full">{dlqSteps.length}</span>
            )}
          </button>
        </div>

        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
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
                        <span className={run.status === 'SUCCEEDED' ? 'text-green-400' : 'text-yellow-400'}>{run.status}</span>
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
                  {/* Added the Refresh Button Here */}
                  <div className="mb-6 flex justify-between items-start text-sm">
                    <div className="grid grid-cols-2 gap-4">
                      <div><span className="text-gray-400">Run ID:</span> <span className="font-mono text-xs">{activeRun.id}</span></div>
                      <div><span className="text-gray-400">Workflow:</span> {activeRun.workflow_name}</div>
                    </div>
                    <button 
                      onClick={refreshRun}
                      className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-xs font-medium transition-colors"
                    >
                      Refresh Status
                    </button>
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
                          <span className={`px-3 py-1 rounded-full text-xs font-bold ${step.status === 'SUCCEEDED' ? 'bg-green-900 text-green-300' :
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
        )}

        {/* DEAD LETTER QUEUE TAB */}
        {activeTab === 'dlq' && (
          <div className="bg-gray-800 rounded-xl p-6 shadow-lg">
            <h2 className="text-lg font-semibold mb-4 border-b border-gray-700 pb-2">Dead Letter Queue (Failed Steps)</h2>
            {dlqSteps.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-green-400 text-lg font-medium">No failed steps!</p>
                <p className="text-gray-500 text-sm mt-2">The system is healthy.</p>
              </div>
            ) : (
              <table className="w-full text-left text-sm text-gray-300">
                <thead className="text-xs uppercase bg-gray-700 text-gray-400">
                  <tr>
                    <th className="px-4 py-3 rounded-tl-lg">Step Name</th>
                    <th className="px-4 py-3">Run ID</th>
                    <th className="px-4 py-3">Attempts</th>
                    <th className="px-4 py-3 rounded-tr-lg">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {dlqSteps.map(step => (
                    <tr key={step.id} className="border-b border-gray-700 hover:bg-gray-750">
                      <td className="px-4 py-3 font-medium text-red-400">{step.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{step.run_id}</td>
                      <td className="px-4 py-3">{step.attempt_count}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => retryStep(step.id)}
                          className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-bold transition-colors"
                        >
                          Retry
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

      </div>

      {/* --- AI COPILOT UI --- */}
      <button
        onClick={() => setChatOpen(!chatOpen)}
        className="fixed bottom-6 right-6 bg-purple-600 hover:bg-purple-700 text-white rounded-full p-4 shadow-lg transition-transform hover:scale-105 z-50"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
      </button>

      {chatOpen && (
        <div className="fixed bottom-24 right-6 w-96 h-[500px] bg-gray-800 rounded-xl shadow-2xl flex flex-col border border-gray-700 z-50 overflow-hidden">
          <div className="bg-gray-900 p-4 border-b border-gray-700 flex justify-between items-center">
            <h3 className="font-bold text-purple-400">AI Copilot</h3>
            <button onClick={() => setChatOpen(false)} className="text-gray-400 hover:text-white">✕</button>
          </div>

          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            {chatHistory.length === 0 && (
              <p className="text-gray-500 text-sm text-center mt-10">
                Ask me about your workflows!<br /><br />
                Try: "Did any steps fail?"<br />or "What is the status of my runs?"
              </p>
            )}
            {chatHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] p-3 rounded-lg text-sm ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-200'}`}>
                  {msg.text}
                </div>
              </div>
            ))}
            {asking && <div className="text-gray-400 text-sm animate-pulse">Copilot is thinking...</div>}
          </div>

          <div className="p-4 border-t border-gray-700 bg-gray-900">
            <div className="flex space-x-2">
              <input
                type="text"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && askCopilot()}
                placeholder="Ask about your runs..."
                className="flex-1 bg-gray-800 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={askCopilot}
                disabled={asking || !question}
                className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;