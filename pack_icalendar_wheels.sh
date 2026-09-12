#!/usr/bin/env bash
# ============================================================
# TackList 离线包打包脚本（Linux）
# 用途：在「能上网」的机器上，把可选依赖 icalendar 及其依赖打包成 wheels/
#       供无外网的内网机离线安装（配合 install_icalendar.sh 使用）
#
# 使用：
#   ./pack_icalendar_wheels.sh            # 按本机 Python 版本打包
#   ./pack_icalendar_wheels.sh 3.8        # 为 Python 3.8 的目标机打包（银河麒麟 V10 SP1 常见）
#   ./pack_icalendar_wheels.sh 3.7        # 为 Python 3.7 的目标机打包（统信 UOS 常见）
#
# 说明：icalendar 及其依赖都是纯 Python 包，打出的 wheel 与 CPU 架构无关，
#       x86_64 / 飞腾 / 鲲鹏 / 龙芯 平台通用。
# ============================================================

set -u

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$APP_DIR/wheels"

C_RESET=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    C_RESET="$(tput sgr0 2>/dev/null || echo '')"
    C_GREEN="$(tput setaf 2 2>/dev/null || echo '')"
    C_YELLOW="$(tput setaf 3 2>/dev/null || echo '')"
    C_BLUE="$(tput setaf 4 2>/dev/null || echo '')"
    C_RED="$(tput setaf 1 2>/dev/null || echo '')"
fi
info() { echo "${C_BLUE}[信息]${C_RESET} $*"; }
ok()   { echo "${C_GREEN}[成功]${C_RESET} $*"; }
warn() { echo "${C_YELLOW}[提示]${C_RESET} $*"; }
err()  { echo "${C_RED}[失败]${C_RESET} $*"; }

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
fi

echo "==== TackList 离线依赖包打包（icalendar，可选依赖）===="
echo

# ---------- 1. 定位本机 Python ----------
PY=""
for cand in python3 python; do
    if command -v "$cand" >/dev/null 2>&1; then
        if "$cand" -c 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)' >/dev/null 2>&1; then
            PY="$cand"; break
        fi
    fi
done
if [ -z "$PY" ]; then
    err "本机未找到 Python 3，无法打包。"
    echo "    处理：sudo apt install python3（或 sudo yum install python3）后重试。"
    exit 1
fi
LOCAL_VER="$("$PY" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
info "本机 Python：$($PY -c 'import sys; print(sys.executable)')（$LOCAL_VER）"

# ---------- 2. 目标 Python 版本 ----------
TARGET="${1:-$LOCAL_VER}"
info "目标机 Python 版本：$TARGET"

TARGET_MINOR="$(echo "$TARGET" | awk -F. '{print $2}')"
case "$TARGET_MINOR" in
    7)       SPEC="icalendar<6"; NOTE="Python 3.7 → icalendar 5.0.x" ;;
    8|9)     SPEC="icalendar<7"; NOTE="Python 3.8/3.9 → icalendar 6.3.x" ;;
    *)       SPEC="icalendar";   NOTE="Python 3.10+ → icalendar 最新版" ;;
esac
info "版本匹配：$NOTE"
EXTRA_PKGS="python-dateutil six tzdata typing-extensions"

# ---------- 3. 检查 pip / 网络 ----------
if ! "$PY" -m pip --version >/dev/null 2>&1; then
    err "本机 pip 不可用。"
    echo "    处理：sudo apt install python3-pip（或 sudo yum install python3-pip）后重试。"
    exit 1
fi

NET_OK=0
if command -v curl >/dev/null 2>&1 && curl -sSf -m 10 -o /dev/null https://pypi.org/simple/ >/dev/null 2>&1; then NET_OK=1
elif command -v wget >/dev/null 2>&1 && wget -q --timeout=10 --tries=1 -O /dev/null https://pypi.org/simple/ >/dev/null 2>&1; then NET_OK=1
elif "$PY" -c "import urllib.request; urllib.request.urlopen('https://pypi.org/simple/', timeout=10)" >/dev/null 2>&1; then NET_OK=1
fi
if [ "$NET_OK" -ne 1 ]; then
    err "本机无法访问 PyPI，无法下载离线包。"
    echo "    处理：请换一台能上网的机器执行本脚本；或配置内网镜像（PIP_INDEX_URL）后重试。"
    exit 1
fi

# ---------- 4. 下载 ----------
mkdir -p "$OUT_DIR"
info "开始下载到 $OUT_DIR ..."

DL_OUT="$("$PY" -m pip download -d "$OUT_DIR" --only-binary=:all: \
    --python-version "$TARGET" --implementation py --abi none --platform any \
    $SPEC $EXTRA_PKGS 2>&1)"
RC=$?
echo "$DL_OUT" | sed 's/^/    /'

if [ "$RC" -ne 0 ]; then
    warn "按目标版本 $TARGET 精确打包失败，回退为按本机 Python 版本打包..."
    DL_OUT2="$("$PY" -m pip download -d "$OUT_DIR" --only-binary=:all: $SPEC $EXTRA_PKGS 2>&1)"
    RC=$?
    echo "$DL_OUT2" | sed 's/^/    /'
    if [ "$RC" -ne 0 ]; then
        err "打包失败。常见原因："
        echo "    · pip 版本过旧 → python3 -m pip install --upgrade pip 后重试"
        echo "    · 网络/代理问题 → 配置 PIP_INDEX_URL 或 HTTPS_PROXY 后重试"
        echo "    · 目标 Python 版本过旧无可用 wheel → 升级目标机 Python 或改用手工安装"
        exit 1
    fi
    warn "已按本机版本（$LOCAL_VER）打包，若目标机版本为 $TARGET，请核对 wheel 是否匹配。"
fi

echo
if ls "$OUT_DIR"/*.whl >/dev/null 2>&1; then
    ok "离线包已生成：$OUT_DIR"
    ls -1 "$OUT_DIR"/*.whl | while read -r w; do echo "    - $(basename "$w")"; done
    echo
    echo "    下一步："
    echo "      1) 把整个 wheels/ 目录拷贝到目标机，与 install_icalendar.sh 放在同一目录"
    echo "      2) 在目标机执行：./install_icalendar.sh"
    echo "      （脚本会自动识别 wheels/ 并离线安装，全程不联网）"
else
    err "未生成任何 wheel 文件，请检查上面的错误信息。"
    exit 1
fi
