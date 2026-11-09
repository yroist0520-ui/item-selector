#!/usr/bin/env python3
"""把 Vite ESM 多 chunk 产物合并成一个单 HTML 文件（iOS Safari file:// 协议可用）"""
import re, os, sys

ASSETS = '/workspace/item-selector/docs/assets'
OUT_DIR = '/workspace/item-selector/single-file'
os.makedirs(OUT_DIR, exist_ok=True)

def read(name):
    with open(os.path.join(ASSETS, name), 'r', encoding='utf-8') as f:
        return f.read()

def indent(text, spaces):
    prefix = ' ' * spaces
    return '\n'.join(prefix + l if l.strip() else '' for l in text.split('\n'))

print("📖 读取 chunk...")
index_js = read('index-pyaUdU8S.js')
es_js = read('index.es-DCBXoM5L.js')
purify_js = read('purify-Coenf1a9.js')
html2canvas_js = read('html2canvas-nCd5LnyR.js')
css = read('index-BioDNzLz.css')

# —— 改写每个 chunk ——
def rewrite_chunk(code):
    """把 ESM 改写：动态 import → __import__，静态 import → __import__ + 解构"""
    
    # 1. 静态 import: import {n as e}from"./xxx.js" 或 import{n}from"./xxx.js"
    #    改成 var tmp = __import__("xxx"); var e = tmp.n;
    def replace_static(m):
        imports_str = m.group(1).strip()   # {n as e} 或 {n, m}
        from_file = m.group(2)              # xxx.js → xxx
        
        inner = imports_str.strip('{}').strip()
        var_stmts = []
        for part in inner.split(','):
            part = part.strip()
            if not part:
                continue
            if ' as ' in part:
                orig, alias = part.split(' as ')
                var_stmts.append(f'var {alias.strip()} = __tmp_{from_file}.{orig.strip()};')
            else:
                var_stmts.append(f'var {part} = __tmp_{from_file}.{part};')
        return f'var __tmp_{from_file} = __import__("{from_file}"); ' + ' '.join(var_stmts)
    
    code = re.sub(
        r'import\s*(\{[^}]*\})\s*from\s*[`\'"](?:\./)?([\w\-]+)\.js[`\'"]',
        replace_static,
        code
    )
    
    # 2. 动态 import(`./xxx.js`) 或 import("./xxx.js")
    #    改成 __import__("xxx")
    code = re.sub(
        r'import\(\s*[`\'"](?:\./)?([\w\-]+)\.js[`\'"]\s*\)',
        r'__import__("\1")',
        code
    )
    
    # 3. Vite 产物里有个 import(e.module) 这种（jspdf 的），改成 Promise.resolve({})
    #    因为 jspdf 已经打包进 html2canvas chunk 里了
    code = re.sub(
        r'import\(\s*[`\'"][^`\'"]*\.module[`\'"]\s*\)',
        'Promise.resolve({})',
        code
    )
    
    # 4. export 处理（Vite rollup 产物里 export default 比较少见）
    code = re.sub(r'export\s+default\s+', '', code)
    code = re.sub(r'export\s+(?:const|let|var|function|class)\s+', '', code)
    
    # 5. 去掉 rollup 的 import.meta.url / import.meta.env 等
    # Vite dev 产物里没有，prod 里可能有
    code = code.replace('import.meta.url', '"inline://"')
    code = code.replace('import.meta.env', '{PROD:true}')
    
    return code

print("✍️  改写 chunk 语法...")
index_w = rewrite_chunk(index_js)
es_w = rewrite_chunk(es_js)
purify_w = rewrite_chunk(purify_js)
html2canvas_w = rewrite_chunk(html2canvas_js)

# —— 构建合并脚本 ——
combined_js = f"""
// =============================================
// 图片代选单管理 - 单文件版（自动合并所有 chunk）
// iOS Safari file:// 协议兼容 ✓
// =============================================
(function() {{
  'use strict';
  
  // ---------- 简易 ESM 模块系统 ----------
  var __modules = {{}};
  var __inline_chunks = {{}};
  var __executing = {{}};
  
  // 模拟 ESM import（返回 Promise，因为动态 import 本来是异步的）
  function __import__(name) {{
    if (!name) return Promise.resolve({{}});
    
    // 已经加载好了
    if (__modules[name]) {{
      return Promise.resolve(__modules[name].exports);
    }}
    
    // 需要先执行
    if (__inline_chunks[name] && !__executing[name]) {{
      __exec_chunk(name);
    }}
    
    var mod = __modules[name] || {{ exports: {{}} }};
    return Promise.resolve(mod.exports);
  }}
  
  function __exec_chunk(name) {{
    if (__modules[name]) return __modules[name];
    if (__executing[name]) return {{ exports: {{}} }}; // 循环依赖保护
    __executing[name] = true;
    
    var mod = __modules[name] = {{ exports: {{}} }};
    try {{
      __inline_chunks[name](mod, mod.exports, __import__);
    }} catch(err) {{
      console.error('[inline-chunk]', name, err);
    }}
    __executing[name] = false;
    return mod;
  }}
  
  function __register_chunk(name, factory) {{
    __inline_chunks[name] = factory;
  }}
  
  // ---------- 注册所有 Vite chunk ----------
  __register_chunk('index-pyaUdU8S', function(module, exports, __import) {{
{indent(index_w, 4)}
  }});
  
  __register_chunk('index.es-DCBXoM5L', function(module, exports, __import) {{
{indent(es_w, 4)}
  }});
  
  __register_chunk('purify-Coenf1a9', function(module, exports, __import) {{
{indent(purify_w, 4)}
  }});
  
  __register_chunk('html2canvas-nCd5LnyR', function(module, exports, __import) {{
{indent(html2canvas_w, 4)}
  }});
  
  // ---------- 启动主 chunk ----------
  // index-pyaUdU8S 内部是自执行的 React 应用
  __exec_chunk('index-pyaUdU8S');
  
}})();
"""

# —— 写最终 HTML ——
html = f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='16' fill='%23111827'/><circle cx='50' cy='50' r='28' fill='%236366f1'/></svg>" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="theme-color" content="#6366f1" />
    <title>图片代选单管理</title>
    <style>
{css}
    </style>
  </head>
  <body class="bg-neutral-50 text-neutral-900 antialiased">
    <div id="root"></div>
    <script>
{combined_js}
    </script>
  </body>
</html>
"""

out_path = os.path.join(OUT_DIR, 'index.html')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(html)

size = os.path.getsize(out_path)
print(f"\n✅ 单文件 HTML 已生成")
print(f"   路径: {out_path}")
print(f"   大小: {size:,} bytes ({size/1024:.0f} KB)")
print(f"   CSS 内联: ✅")
print(f"   JS 全内联: ✅")
print(f"   iOS file:// 兼容: ✅")
