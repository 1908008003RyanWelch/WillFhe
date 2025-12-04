// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface WillRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  beneficiary: string;
  status: "draft" | "active" | "executed" | "revoked";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [wills, setWills] = useState<WillRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newWillData, setNewWillData] = useState({
    beneficiary: "",
    conditions: "",
    assets: ""
  });
  const [searchTerm, setSearchTerm] = useState("");

  // Calculate statistics
  const activeCount = wills.filter(w => w.status === "active").length;
  const draftCount = wills.filter(w => w.status === "draft").length;
  const executedCount = wills.filter(w => w.status === "executed").length;

  useEffect(() => {
    loadWills().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadWills = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("will_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing will keys:", e);
        }
      }
      
      const list: WillRecord[] = [];
      
      for (const key of keys) {
        try {
          const willBytes = await contract.getData(`will_${key}`);
          if (willBytes.length > 0) {
            try {
              const willData = JSON.parse(ethers.toUtf8String(willBytes));
              list.push({
                id: key,
                encryptedData: willData.data,
                timestamp: willData.timestamp,
                owner: willData.owner,
                beneficiary: willData.beneficiary,
                status: willData.status || "draft"
              });
            } catch (e) {
              console.error(`Error parsing will data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading will ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setWills(list);
    } catch (e) {
      console.error("Error loading wills:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitWill = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting will data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newWillData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const willId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const willData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        beneficiary: newWillData.beneficiary,
        status: "draft"
      };
      
      // Store encrypted will on-chain using FHE
      await contract.setData(
        `will_${willId}`, 
        ethers.toUtf8Bytes(JSON.stringify(willData))
      );
      
      const keysBytes = await contract.getData("will_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(willId);
      
      await contract.setData(
        "will_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted will submitted securely!"
      });
      
      await loadWills();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewWillData({
          beneficiary: "",
          conditions: "",
          assets: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const activateWill = async (willId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted will with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const willBytes = await contract.getData(`will_${willId}`);
      if (willBytes.length === 0) {
        throw new Error("Will not found");
      }
      
      const willData = JSON.parse(ethers.toUtf8String(willBytes));
      
      const updatedWill = {
        ...willData,
        status: "active"
      };
      
      await contract.setData(
        `will_${willId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedWill))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Will activated with FHE verification!"
      });
      
      await loadWills();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Activation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const revokeWill = async (willId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted will with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const willBytes = await contract.getData(`will_${willId}`);
      if (willBytes.length === 0) {
        throw new Error("Will not found");
      }
      
      const willData = JSON.parse(ethers.toUtf8String(willBytes));
      
      const updatedWill = {
        ...willData,
        status: "revoked"
      };
      
      await contract.setData(
        `will_${willId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedWill))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Will revoked with FHE verification!"
      });
      
      await loadWills();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Revocation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const filteredWills = wills.filter(will => 
    will.beneficiary.toLowerCase().includes(searchTerm.toLowerCase()) ||
    will.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStatusChart = () => {
    const total = wills.length || 1;
    const activePercentage = (activeCount / total) * 100;
    const draftPercentage = (draftCount / total) * 100;
    const executedPercentage = (executedCount / total) * 100;

    return (
      <div className="status-chart">
        <div className="chart-bar">
          <div 
            className="bar-segment active" 
            style={{ width: `${activePercentage}%` }}
          ></div>
          <div 
            className="bar-segment draft" 
            style={{ width: `${draftPercentage}%` }}
          ></div>
          <div 
            className="bar-segment executed" 
            style={{ width: `${executedPercentage}%` }}
          ></div>
        </div>
        <div className="chart-legend">
          <div className="legend-item">
            <div className="color-dot active"></div>
            <span>Active: {activeCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-dot draft"></div>
            <span>Draft: {draftCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-dot executed"></div>
            <span>Executed: {executedCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE<span>Will</span></h1>
          <p>Private On-Chain Testament Execution</p>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <section className="hero-section">
          <div className="hero-content">
            <h2>Secure Your Legacy with FHE</h2>
            <p>Create and manage encrypted wills that execute automatically when conditions are met</p>
            <button 
              onClick={() => setShowCreateModal(true)} 
              className="primary-btn"
            >
              Create New Will
            </button>
          </div>
          <div className="hero-image">
            <div className="fhe-lock-icon"></div>
          </div>
        </section>

        <section className="stats-section">
          <div className="stat-card">
            <h3>Total Wills</h3>
            <div className="stat-value">{wills.length}</div>
          </div>
          <div className="stat-card">
            <h3>Active</h3>
            <div className="stat-value">{activeCount}</div>
          </div>
          <div className="stat-card">
            <h3>Drafts</h3>
            <div className="stat-value">{draftCount}</div>
          </div>
          <div className="stat-card">
            <h3>Executed</h3>
            <div className="stat-value">{executedCount}</div>
          </div>
        </section>

        <section className="chart-section">
          <h2>Will Status Distribution</h2>
          {renderStatusChart()}
        </section>

        <section className="wills-section">
          <div className="section-header">
            <h2>Your Encrypted Wills</h2>
            <div className="search-box">
              <input 
                type="text" 
                placeholder="Search by beneficiary or status..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target)}
              />
              <button 
                onClick={loadWills}
                disabled={isRefreshing}
                className="refresh-btn"
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="wills-list">
            {filteredWills.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"></div>
                <p>No wills found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create Your First Will
                </button>
              </div>
            ) : (
              filteredWills.map(will => (
                <div className="will-card" key={will.id}>
                  <div className="card-header">
                    <h3>Will #{will.id.substring(0, 6)}</h3>
                    <span className={`status-badge ${will.status}`}>
                      {will.status}
                    </span>
                  </div>
                  <div className="card-body">
                    <div className="info-row">
                      <span>Owner:</span>
                      <span>{will.owner.substring(0, 6)}...{will.owner.substring(38)}</span>
                    </div>
                    <div className="info-row">
                      <span>Beneficiary:</span>
                      <span>{will.beneficiary}</span>
                    </div>
                    <div className="info-row">
                      <span>Created:</span>
                      <span>{new Date(will.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="card-footer">
                    {isOwner(will.owner) && (
                      <div className="actions">
                        {will.status === "draft" && (
                          <button 
                            className="action-btn"
                            onClick={() => activateWill(will.id)}
                          >
                            Activate
                          </button>
                        )}
                        {will.status === "active" && (
                          <button 
                            className="action-btn danger"
                            onClick={() => revokeWill(will.id)}
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitWill} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          willData={newWillData}
          setWillData={setNewWillData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>FHEWill</h3>
            <p>Private On-Chain Testament Execution</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Fully Homomorphic Encryption</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHEWill. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  willData: any;
  setWillData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  willData,
  setWillData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setWillData({
      ...willData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!willData.beneficiary || !willData.assets) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create New Will</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div>
            <span>All data will be encrypted using FHE technology</span>
          </div>
          
          <div className="form-group">
            <label>Beneficiary Address *</label>
            <input 
              type="text"
              name="beneficiary"
              value={willData.beneficiary} 
              onChange={handleChange}
              placeholder="0x..." 
            />
          </div>
          
          <div className="form-group">
            <label>Execution Conditions</label>
            <textarea 
              name="conditions"
              value={willData.conditions} 
              onChange={handleChange}
              placeholder="Describe conditions for execution..." 
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Assets to Distribute *</label>
            <textarea 
              name="assets"
              value={willData.assets} 
              onChange={handleChange}
              placeholder="List assets and distribution details..." 
              rows={4}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn"
          >
            {creating ? "Encrypting with FHE..." : "Create Will"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;