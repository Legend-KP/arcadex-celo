var arcadeXGameObjectName = "ArcadeXBridge";
var pendingUnityCallbacks = [];
var pendingFlushTimer = null;

function getUnityInstance() {
  if (typeof unityInstance !== "undefined" && unityInstance) {
    return unityInstance;
  }
  if (typeof unityGameInstance !== "undefined" && unityGameInstance) {
    return unityGameInstance;
  }
  if (typeof gameInstance !== "undefined" && gameInstance) {
    return gameInstance;
  }
  if (typeof Module !== "undefined" && Module.SendMessage) {
    return {
      SendMessage: function (go, method, value) {
        Module.SendMessage(go, method, value);
      },
    };
  }
  return null;
}

function deliverToUnity(method, value) {
  var instance = getUnityInstance();
  if (instance && instance.SendMessage) {
    instance.SendMessage(arcadeXGameObjectName, method, value);
    return true;
  }
  return false;
}

function flushPendingUnityCallbacks() {
  if (!pendingUnityCallbacks.length) {
    return;
  }

  pendingUnityCallbacks = pendingUnityCallbacks.filter(function (item) {
    if (Date.now() - item.at > 60000) {
      console.warn(
        "[ArcadeXBridge] Dropped Unity callback (instance unavailable):",
        item.method
      );
      return false;
    }
    return !deliverToUnity(item.method, item.value);
  });

  if (!pendingUnityCallbacks.length && pendingFlushTimer !== null) {
    clearInterval(pendingFlushTimer);
    pendingFlushTimer = null;
  }
}

function queueUnityCallback(method, value) {
  pendingUnityCallbacks.push({
    method: method,
    value: value,
    at: Date.now(),
  });

  if (pendingFlushTimer === null) {
    pendingFlushTimer = setInterval(flushPendingUnityCallbacks, 200);
  }
}

function onPageVisibleAgain() {
  flushPendingUnityCallbacks();
}

window.__arcadeXDeliverCallback = function (method, value) {
  if (!deliverToUnity(method, value)) {
    queueUnityCallback(method, value);
  }
};

mergeInto(LibraryManager.library, {
  ArcadeX_Init: function (gameObjectNamePtr) {
    arcadeXGameObjectName = UTF8ToString(gameObjectNamePtr);

    window.addEventListener("message", function (event) {
      var data = event.data;
      if (!data || data.type !== "UNITY_CALLBACK") return;

      var value =
        typeof data.value === "string"
          ? data.value
          : JSON.stringify(data.value);

      if (!deliverToUnity(data.method, value)) {
        queueUnityCallback(data.method, value);
      }
    });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        onPageVisibleAgain();
      }
    });
    window.addEventListener("pageshow", onPageVisibleAgain);
    window.addEventListener("focus", onPageVisibleAgain);

    flushPendingUnityCallbacks();
  },

  ArcadeX_SendToParent: function (jsonPtr) {
    var json = UTF8ToString(jsonPtr);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(JSON.parse(json), "*");
    }
  },
});
