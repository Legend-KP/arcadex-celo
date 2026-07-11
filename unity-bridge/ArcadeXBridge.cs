using System;
using System.Runtime.InteropServices;
using UnityEngine;

/// <summary>
/// ArcadeX shell bridge for Unity WebGL games.
/// Drop this script + ArcadeXBridge.jslib into your Unity project.
/// </summary>
public class ArcadeXBridge : MonoBehaviour
{
    public static ArcadeXBridge Instance { get; private set; }

    public string GameId { get; private set; }
    public string PlayerName { get; private set; }
    public string WalletAddress { get; private set; }
    public int HighScore { get; private set; }
    public int Level { get; private set; }
    public bool HasLeaderboard { get; private set; }
    public bool ContestLive { get; private set; }

    public event Action<ArcadeXBootstrapData> OnBootstrapReady;
    public event Action<ArcadeXLeaderboardEntry[]> OnLeaderboardReady;
    public event Action<ArcadeXProgressSaveResult> ProgressSaved;
    public event Action<ArcadeXLeaderboardSubmitResult> LeaderboardSubmitCompleted;
    /// <summary>Legacy bool callback — fired alongside LeaderboardSubmitCompleted.</summary>
    public event Action<bool> OnScoreSubmitComplete;

    private const string DefaultPlayerName = "Player";

#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")]
    private static extern void ArcadeX_Init(string gameObjectName);

    [DllImport("__Internal")]
    private static extern void ArcadeX_SendToParent(string json);
#endif

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    private static void Bootstrap()
    {
        if (Instance != null)
        {
            return;
        }

        GameObject bridgeObject = new GameObject(nameof(ArcadeXBridge));
        bridgeObject.AddComponent<ArcadeXBridge>();
    }

    private void Awake()
    {
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);
            return;
        }

        Instance = this;
        DontDestroyOnLoad(gameObject);
    }

    private void Start()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        ArcadeX_Init(gameObject.name);
#endif
        SendBootstrap();
    }

    public void SendBootstrap()
    {
        SendMessageToParent(new ArcadeXBridgeMessage { type = "GAME_BOOTSTRAP" });
    }

    /// <summary>
    /// Saves personal best only (RTDB users/{wallet}/games/{gameId}.s).
    /// Does not post to the public leaderboard or charge a fee.
    /// </summary>
    public void SaveProgress(int score)
    {
        if (score <= 0)
        {
            return;
        }

        SendMessageToParent(new ArcadeXBridgeMessage
        {
            type = "GAME_PROGRESS_SAVE",
            payload = new ArcadeXScorePayload
            {
                score = score,
                walletAddress = WalletAddress
            }
        });
    }

    /// <summary>
    /// Paid leaderboard submit. Shell opens the wallet, verifies payment,
    /// then posts the score to the public leaderboard.
    /// Personal best in RTDB is not modified.
    /// </summary>
    public void SubmitToLeaderboard(int score)
    {
        if (score <= 0)
        {
            return;
        }

        SendMessageToParent(new ArcadeXBridgeMessage
        {
            type = "GAME_LEADERBOARD_SUBMIT",
            payload = new ArcadeXScorePayload
            {
                score = score,
                walletAddress = WalletAddress
            }
        });
    }

    /// <summary>Alias for SubmitToLeaderboard — older game code may call this.</summary>
    public void SubmitScore(int score) => SubmitToLeaderboard(score);

    public void RequestLeaderboard()
    {
        SendMessageToParent(new ArcadeXBridgeMessage { type = "GAME_LEADERBOARD_GET" });
    }

    public void RequestProgress()
    {
        SendMessageToParent(new ArcadeXBridgeMessage { type = "GAME_PROGRESS_GET" });
    }

    /// <summary>
    /// Ask the shell to re-send the last paid submit result (after wallet / reload).
    /// </summary>
    public void PollSubmitResult()
    {
        SendMessageToParent(new ArcadeXBridgeMessage { type = "GAME_LEADERBOARD_SUBMIT_POLL" });
    }

    private void SendMessageToParent(ArcadeXBridgeMessage message)
    {
        string json = JsonUtility.ToJson(message);
#if UNITY_WEBGL && !UNITY_EDITOR
        ArcadeX_SendToParent(json);
#else
        Debug.Log("[ArcadeXBridge] Would send: " + json);
#endif
    }

    public void OnBootstrapDataReceived(string json)
    {
        ArcadeXBootstrapData data = JsonUtility.FromJson<ArcadeXBootstrapData>(json);
        GameId = data.gameId;
        PlayerName = data.playerName;
        WalletAddress = data.walletAddress;
        HighScore = data.highScore;
        Level = data.level;
        HasLeaderboard = data.hasLeaderboard;
        ContestLive = data.contestLive;
        OnBootstrapReady?.Invoke(data);
    }

    public void OnWalletAddressResolved(string walletAddress)
    {
        WalletAddress = walletAddress;
    }

    public void OnLeaderboardReceived(string json)
    {
        ArcadeXLeaderboardWrapper wrapper = JsonUtility.FromJson<ArcadeXLeaderboardWrapper>("{\"entries\":" + json + "}");
        OnLeaderboardReady?.Invoke(wrapper.entries ?? Array.Empty<ArcadeXLeaderboardEntry>());
    }

    public void OnProgressSaved(string json)
    {
        ArcadeXProgressSaveResult result = JsonUtility.FromJson<ArcadeXProgressSaveResult>(json);
        if (result.success)
        {
            HighScore = result.highScore;
        }
        ProgressSaved?.Invoke(result);
    }

    /// <summary>
    /// Legacy callback — free saves and paid leaderboard submits both use this name.
    /// Payloads with leaderboardScore route to LeaderboardSubmitCompleted.
    /// </summary>
    public void OnScoreSubmitted(string json)
    {
        if (json.Contains("\"leaderboardScore\""))
        {
            OnLeaderboardSubmitComplete(json);
            return;
        }

        OnProgressSaved(json);
    }

    public void OnProgressReceived(string json)
    {
        ArcadeXProgressSaveResult result = JsonUtility.FromJson<ArcadeXProgressSaveResult>(json);
        if (result.success)
        {
            HighScore = result.highScore;
        }
    }

    public void OnLeaderboardSubmitComplete(string json)
    {
        Debug.Log("[ArcadeXBridge] OnLeaderboardSubmitComplete: " + json);
        ArcadeXLeaderboardSubmitResult result =
            JsonUtility.FromJson<ArcadeXLeaderboardSubmitResult>(json);
        LeaderboardSubmitCompleted?.Invoke(result);
        OnScoreSubmitComplete?.Invoke(result.success);
    }
}

[Serializable]
public class ArcadeXBridgeMessage
{
    public string type;
    public ArcadeXScorePayload payload;
}

[Serializable]
public class ArcadeXScorePayload
{
    public string name;
    public int score;
    public string walletAddress;
}

[Serializable]
public class ArcadeXBootstrapData
{
    public string gameId;
    public string shellOrigin;
    public string walletAddress;
    public string playerName;
    public int highScore;
    public int level;
    public bool hasLeaderboard;
    public bool contestLive;
    public int hints;
    public bool tutorialComplete;
    public bool gamePurchased;
}

[Serializable]
public class ArcadeXLeaderboardEntry
{
    public string name;
    public int score;
    public string walletAddress;
    public long createdAt;
}

[Serializable]
public class ArcadeXLeaderboardWrapper
{
    public ArcadeXLeaderboardEntry[] entries;
}

[Serializable]
public class ArcadeXProgressSaveResult
{
    public bool success;
    public int highScore;
    public string error;
}

[Serializable]
public class ArcadeXLeaderboardSubmitResult
{
    public bool success;
    public int highScore;
    public int leaderboardScore;
    public string error;
}
