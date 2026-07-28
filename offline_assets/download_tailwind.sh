#!/bin/bash
# 下载预编译的 Tailwind CSS（Windows/Linux/Mac）

mkdir -p offline_assets/tailwind

# 如果在Windows上用PowerShell，可以用这个：
# Invoke-WebRequest -Uri "https://cdn.tailwindcss.com" -OutFile "offline_assets/tailwind/tailwind.css"

# Linux/Mac 上使用 curl 或 wget：
# curl -O https://cdn.tailwindcss.com
# 或
# wget https://cdn.tailwindcss.com -O offline_assets/tailwindcss

echo "请手动下载以下文件："
echo ""
echo "1. 访问 https://cdn.tailwindcss.com"
echo "2. 右键 → 另存为 → 保存到当前目录的 offline_assets/tailwindcss 文件"
echo "3. 文件名保存为: tailwindcss（无扩展名）"
echo ""
echo "或者使用命令行："
echo "curl https://cdn.tailwindcss.com > offline_assets/tailwindcss"
echo ""
echo "下载完成后告诉我，我会帮您修改 index.html！"
