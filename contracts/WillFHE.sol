// WillFHE.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract WillFHE is SepoliaConfig {
    struct EncryptedWill {
        uint256 id;
        euint32 encryptedBeneficiaries;
        euint32 encryptedAssets;
        euint32 encryptedConditions;
        uint256 timestamp;
    }
    
    struct ExecutionStatus {
        euint32 encryptedVerification;
        euint32 encryptedDistributionStatus;
    }

    struct DecryptedWill {
        string beneficiaries;
        string assets;
        string conditions;
        bool isRevealed;
    }

    uint256 public willCount;
    mapping(uint256 => EncryptedWill) public encryptedWills;
    mapping(uint256 => DecryptedWill) public decryptedWills;
    mapping(uint256 => ExecutionStatus) public executionStatuses;
    
    mapping(uint256 => uint256) private requestToWillId;
    
    event WillCreated(uint256 indexed id, uint256 timestamp);
    event VerificationRequested(uint256 indexed willId);
    event ExecutionTriggered(uint256 indexed willId);
    event DecryptionRequested(uint256 indexed willId);
    event WillDecrypted(uint256 indexed willId);
    
    modifier onlyOwner(uint256 willId) {
        _;
    }
    
    function createEncryptedWill(
        euint32 encryptedBeneficiaries,
        euint32 encryptedAssets,
        euint32 encryptedConditions
    ) public {
        willCount += 1;
        uint256 newId = willCount;
        
        encryptedWills[newId] = EncryptedWill({
            id: newId,
            encryptedBeneficiaries: encryptedBeneficiaries,
            encryptedAssets: encryptedAssets,
            encryptedConditions: encryptedConditions,
            timestamp: block.timestamp
        });
        
        decryptedWills[newId] = DecryptedWill({
            beneficiaries: "",
            assets: "",
            conditions: "",
            isRevealed: false
        });
        
        emit WillCreated(newId, block.timestamp);
    }
    
    function requestWillDecryption(uint256 willId) public onlyOwner(willId) {
        EncryptedWill storage will = encryptedWills[willId];
        require(!decryptedWills[willId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(will.encryptedBeneficiaries);
        ciphertexts[1] = FHE.toBytes32(will.encryptedAssets);
        ciphertexts[2] = FHE.toBytes32(will.encryptedConditions);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptWill.selector);
        requestToWillId[reqId] = willId;
        
        emit DecryptionRequested(willId);
    }
    
    function decryptWill(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 willId = requestToWillId[requestId];
        require(willId != 0, "Invalid request");
        
        EncryptedWill storage eWill = encryptedWills[willId];
        DecryptedWill storage dWill = decryptedWills[willId];
        require(!dWill.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        string[] memory results = abi.decode(cleartexts, (string[]));
        
        dWill.beneficiaries = results[0];
        dWill.assets = results[1];
        dWill.conditions = results[2];
        dWill.isRevealed = true;
        
        emit WillDecrypted(willId);
    }
    
    function requestConditionVerification(uint256 willId) public {
        require(encryptedWills[willId].id != 0, "Will not found");
        
        emit VerificationRequested(willId);
    }
    
    function submitVerificationResult(
        uint256 willId,
        euint32 encryptedVerification,
        euint32 encryptedDistributionStatus
    ) public {
        executionStatuses[willId] = ExecutionStatus({
            encryptedVerification: encryptedVerification,
            encryptedDistributionStatus: encryptedDistributionStatus
        });
        
        emit ExecutionTriggered(willId);
    }
    
    function requestStatusDecryption(uint256 willId, uint8 statusType) public onlyOwner(willId) {
        ExecutionStatus storage status = executionStatuses[willId];
        require(FHE.isInitialized(status.encryptedVerification), "No status available");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        
        if (statusType == 0) {
            ciphertexts[0] = FHE.toBytes32(status.encryptedVerification);
        } else if (statusType == 1) {
            ciphertexts[0] = FHE.toBytes32(status.encryptedDistributionStatus);
        } else {
            revert("Invalid status type");
        }
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptExecutionStatus.selector);
        requestToWillId[reqId] = willId * 10 + statusType;
    }
    
    function decryptExecutionStatus(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 compositeId = requestToWillId[requestId];
        uint256 willId = compositeId / 10;
        uint8 statusType = uint8(compositeId % 10);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        string memory result = abi.decode(cleartexts, (string));
    }
    
    function getDecryptedWill(uint256 willId) public view returns (
        string memory beneficiaries,
        string memory assets,
        string memory conditions,
        bool isRevealed
    ) {
        DecryptedWill storage w = decryptedWills[willId];
        return (w.beneficiaries, w.assets, w.conditions, w.isRevealed);
    }
    
    function hasExecutionStatus(uint256 willId) public view returns (bool) {
        return FHE.isInitialized(executionStatuses[willId].encryptedVerification);
    }
}