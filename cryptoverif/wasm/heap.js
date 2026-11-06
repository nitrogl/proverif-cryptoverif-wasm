/*
 * Limiting memory in Enscripten 3.1.69
 * 
 * WARNING this is hardly any portable across Enscripten versions!
 * TODO Generalize hardcoded values, especially 4GB coming from 32-bit compilation.
 *
 * SPDX-License-Identifier: CECILL-B
 */

mergeInto(LibraryManager.library, {
  emscripten_get_heap_max: function() {
    var limit = Module["memoryLimit"] || 4294901760;
    return Math.min(4294901760, Math.floor(limit / 65536) * 65536);
  },
  
  // Local implementation of the helper needed by emscripten_resize_heap.
  $emscripten_realloc_buffer: function(size) {
    var oldSize = wasmMemory.buffer.byteLength;
    var pages = (size - oldSize) / 65536;
    
    if (pages <= 0) return true;
    
    try {
      wasmMemory.grow(pages);
      updateMemoryViews();
      return true;
    } catch (e) {
      return false;
    }
  },
  
  emscripten_resize_heap__deps: ["emscripten_get_heap_max", "$emscripten_realloc_buffer"],
  
  emscripten_resize_heap: function(requestedSize) {
    var oldSize = HEAPU8.length;
    var limit = _emscripten_get_heap_max();
    requestedSize = requestedSize >>> 0;
    if (requestedSize <= limit) {
      // I grow by a quarter, at least 16 MB, within the limit; if the
      // browser refuses, I try again with just what was asked
      var wanted = Math.max(requestedSize, oldSize + Math.max(oldSize >>> 2, 16777216));
      var sizes = [Math.min(limit, Math.ceil(wanted / 65536) * 65536), Math.ceil(requestedSize / 65536) * 65536];
      for (var i = 0; i < sizes.length; i++) {
        if (sizes[i] >= requestedSize && emscripten_realloc_buffer(sizes[i])) {
          if (Module["onMemoryGrowth"]) {
            Module["onMemoryGrowth"](HEAPU8.length);
          }
          return true;
        }
      }
    }
    if (Module["onMemoryLimit"]) {
      Module["onMemoryLimit"](requestedSize, limit);
    }
    return false;
  }
});
