{
  "targets": [
    {
      "target_name": "ez_native",
      "sources": ["src/ez_native.cc"],
      "defines": ["UNICODE", "_UNICODE", "WIN32_LEAN_AND_MEAN", "NOMINMAX", "NAPI_VERSION=8"],
      "libraries": ["user32.lib"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/std:c++17", "/W3"]
        }
      }
    }
  ]
}
