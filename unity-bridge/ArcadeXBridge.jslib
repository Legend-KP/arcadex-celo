var arcadeXGameObjectName = "ArcadeXBridge";

mergeInto(LibraryManager.library, {
  ArcadeX_Init: function (gameObjectNamePtr) {
    arcadeXGameObjectName = UTF8ToString(gameObjectNamePtr);

    window.addEventListener("message", function (event) {
      var data = event.data;
      if (!data || data.type !== "UNITY_CALLBACK") return;

      var value =
        typeof data.value === "string" ? data.value : JSON.stringify(data.value);

      var instance =
        typeof unityInstance !== "undefined"
          ? unityInstance
          : typeof unityGameInstance !== "undefined"
          ? unityGameInstance
          : null;

      if (instance && instance.SendMessage) {
        instance.SendMessage(arcadeXGameObjectName, data.method, value);
      }
    });
  },

  ArcadeX_SendToParent: function (jsonPtr) {
    var json = UTF8ToString(jsonPtr);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(JSON.parse(json), "*");
    }
  },
});
