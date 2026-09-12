#!/usr/bin/env bash
# ============================================================
# TackList 可选依赖一键安装脚本（Linux）
# 用途：安装 icalendar —— 仅「外部日历订阅（ICS 同步）」功能需要
# 适用：银河麒麟 V10 SP1 / 统信 UOS / Ubuntu / Debian / CentOS / RHEL 等
#
# 使用：
#   ./install_icalendar.sh              # 联网安装（或自动使用同目录 wheels/ 离线包）
#   ./install_icalendar.sh --help       # 查看帮助
#
# 若自动检测不到正确的 Python，可显式指定：
#   PYTHON=/usr/bin/python3.8 ./install_icalendar.sh
#
# 说明：这是「可选项」。若不需要外部日历订阅，或处在无外网的内网环境，
#       不必安装，系统其余功能完全可用。
# ============================================================

set -u

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
WHEELS_DIR="$APP_DIR/wheels"
LOG_FILE="$APP_DIR/install_icalendar.log"

C_RESET=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    C_RESET="$(tput sgr0 2>/dev/null || echo '')"
    C_RED="$(tput setaf 1 2>/dev/null || echo '')"
    C_GREEN="$(tput setaf 2 2>/dev/null || echo '')"
    C_YELLOW="$(tput setaf 3 2>/dev/null || echo '')"
    C_BLUE="$(tput setaf 4 2>/dev/null || echo '')"
fi

info()  { echo "${C_BLUE}[信息]${C_RESET} $*"; }
ok()    { echo "${C_GREEN}[成功]${C_RESET} $*"; }
warn()  { echo "${C_YELLOW}[提示]${C_RESET} $*"; }
err()   { echo "${C_RED}[失败]${C_RESET} $*"; }
title() { echo; echo "${C_BLUE}==== $* ====${C_RESET}"; }

log() { echo "$*" >>"$LOG_FILE" 2>/dev/null || true; }

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
fi

title "TackList 可选依赖安装（icalendar）"
echo "本依赖仅用于「外部日历订阅」功能；不需要该功能或无外网时可直接退出（Ctrl+C）。"
echo "若安装失败，完整日志会写入：$LOG_FILE"
echo

# ---------- 1. 定位 Python ----------
info "步骤 1/5：检查 Python 环境"
PY=""
# 允许用环境变量指定：PYTHON=/usr/bin/python3.8 ./install_icalendar.sh
if [ -n "${PYTHON:-}" ] && command -v "$PYTHON" >/dev/null 2>&1; then
    PY="$PYTHON"
else
for cand in python3 python; do
    if command -v "$cand" >/dev/null 2>&1; then
        if "$cand" -c 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)' >/dev/null 2>&1; then
            PY="$cand"
            break
        fi
    fi
done
fi

if [ -z "$PY" ]; then
    err "未找到 Python 3。"
    echo "    处理建议："
    echo "      银河麒麟 / 统信 UOS / Ubuntu / Debian：sudo apt install python3"
    echo "      CentOS / RHEL：                      sudo yum install python3"
    echo "    安装后重新运行本脚本。若确实不需要外部日历订阅，可直接忽略本提示。"
    log "ERROR: python3 not found"
    exit 1
fi

PY_PATH="$(command -v "$PY")"
PY_VER="$("$PY" -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])' 2>/dev/null)"
PY_MINOR="$("$PY" -c 'import sys; print(sys.version_info[1])' 2>/dev/null)"
ok "已找到 Python：$PY_PATH（版本 $PY_VER）"
log "python=$PY_PATH version=$PY_VER"

# ---------- 2. 依据 Python 版本确定可安装版本 ----------
case "$PY_MINOR" in
    7)          SPEC="icalendar<6";  NOTE="Python 3.7 → 安装 icalendar 5.0.x" ;;
    8|9)        SPEC="icalendar<7";  NOTE="Python 3.8/3.9 → 安装 icalendar 6.3.x" ;;
    10|11|12|13|14|15|16|17|18|19) SPEC="icalendar"; NOTE="Python 3.10+ → 安装 icalendar 最新版" ;;
    *)
        if [ -n "$PY_MINOR" ] && [ "$PY_MINOR" -gt 19 ] 2>/dev/null; then
            SPEC="icalendar"; NOTE="Python 3.10+ → 安装 icalendar 最新版"
        else
            err "Python 版本过低：$PY_VER（需要 3.7 及以上）。"
            echo "    处理建议：升级 Python 后重试；或放弃安装本可选依赖（不影响其它功能）。"
            log "ERROR: python too old: $PY_VER"
            exit 1
        fi
        ;;
esac
info "版本匹配：$NOTE"
EXTRA_PKGS="python-dateutil six tzdata typing-extensions"

# ---------- 3. 检查 pip ----------
title "步骤 2/5：检查 pip"
if ! "$PY" -m pip --version >/dev/null 2>&1; then
    warn "当前 Python 没有 pip，尝试自动修复（ensurepip）..."
    if "$PY" -m ensurepip --user >/dev/null 2>&1 || "$PY" -m ensurepip >/dev/null 2>&1; then
        ok "pip 已通过 ensurepip 安装。"
    else
        err "pip 不可用，且自动修复失败。"
        echo "    处理建议（任选其一）："
        echo "      银河麒麟 / 统信 UOS / Ubuntu / Debian：sudo apt install python3-pip"
        echo "      CentOS / RHEL：                      sudo yum install python3-pip"
        echo "      或在联网机用 pack_icalendar_wheels.sh 打包 wheels/ 后，"
        echo "      用 python3 -m zipfile -e xxx.whl <site-packages 目录> 手工解压安装。"
        log "ERROR: pip unavailable"
        exit 1
    fi
fi
ok "pip 可用：$("$PY" -m pip --version 2>/dev/null | head -1)"

# ---------- 4. 判断离线包 / 网络 ----------
title "步骤 3/5：检查安装包来源"
OFFLINE=0
if [ -d "$WHEELS_DIR" ] && ls "$WHEELS_DIR"/*.whl >/dev/null 2>&1; then
    OFFLINE=1
    ok "发现离线包目录 $WHEELS_DIR，将使用离线安装（不联网）。"
    ls -1 "$WHEELS_DIR"/*.whl | while read -r w; do info "  离线包：$(basename "$w")"; done
else
    info "未发现 wheels/ 离线包，检查互联网连通性..."
    NET_OK=0
    if command -v curl >/dev/null 2>&1 && curl -sSf -m 10 -o /dev/null https://pypi.org/simple/ >/dev/null 2>&1; then
        NET_OK=1
    elif command -v wget >/dev/null 2>&1 && wget -q --timeout=10 --tries=1 -O /dev/null https://pypi.org/simple/ >/dev/null 2>&1; then
        NET_OK=1
    elif "$PY" -c "import urllib.request; urllib.request.urlopen('https://pypi.org/simple/', timeout=10)" >/dev/null 2>&1; then
        NET_OK=1
    fi

    if [ "$NET_OK" -ne 1 ]; then
        err "无法访问 PyPI（无互联网连接或被代理/防火墙拦截）。"
        echo "    处理建议："
        echo "      1) 若处在企业内网 / 无外网环境：无需安装本依赖，"
        echo "         系统除「外部日历订阅」外的功能全部可用，直接退出即可。"
        echo "      2) 若确实需要该功能：在能上网的机器上执行 ./pack_icalendar_wheels.sh"
        echo "         生成 wheels/ 目录，拷贝到本机的本脚本同目录后重新运行。"
        echo "      3) 若有内网 PyPI 镜像：先配置 ~/.pip/pip.conf 或环境变量 PIP_INDEX_URL，再重试。"
        log "ERROR: no network to pypi.org"
        exit 1
    fi
    ok "互联网连通正常，将在线安装。"
fi

# ---------- 5. 执行安装 ----------
title "步骤 4/5：安装 icalendar"
USER_OPT="--user"
if [ "$(id -u)" = "0" ]; then USER_OPT=""; fi   # root 下 --user 无意义

run_pip() {
    if [ "$OFFLINE" -eq 1 ]; then
        "$PY" -m pip install $USER_OPT --no-index --find-links="$WHEELS_DIR" $SPEC $EXTRA_PKGS
    else
        "$PY" -m pip install $USER_OPT $SPEC $EXTRA_PKGS
    fi
}

OUT="$(run_pip 2>&1)"
RC=$?
echo "$OUT" | sed 's/^/    /'
log "$OUT"

if [ "$RC" -ne 0 ]; then
    # PEP 668：externally-managed-environment（Debian 12 / 较新的 UOS / Ubuntu 23.04+）
    if echo "$OUT" | grep -qi "externally-managed-environment"; then
        warn "检测到系统启用了 PEP 668 保护，正在加 --break-system-packages 重试..."
        OUT2="$(if [ "$OFFLINE" -eq 1 ]; then
                    "$PY" -m pip install $USER_OPT --break-system-packages --no-index --find-links="$WHEELS_DIR" $SPEC $EXTRA_PKGS
                else
                    "$PY" -m pip install $USER_OPT --break-system-packages $SPEC $EXTRA_PKGS
                fi 2>&1)"
        RC=$?
        echo "$OUT2" | sed 's/^/    /'
        log "$OUT2"
    fi
fi

if [ "$RC" -ne 0 ]; then
    err "安装失败。常见原因与处理："
    echo "    · 无外网 / 被代理拦截 → 改用离线包（pack_icalendar_wheels.sh）或配置 PIP_INDEX_URL"
    echo "    · 权限不足           → 用 sudo 运行，或保持 --user 安装到当前用户"
    echo "    · PEP 668 限制       → 改用系统包：sudo apt install python3-icalendar"
    echo "    · pip 版本过旧       → python3 -m pip install --upgrade pip 后重试"
    echo "    · 版本冲突           → 完整输出见：$LOG_FILE"
    log "ERROR: pip install failed rc=$RC"
    exit 1
fi

# ---------- 6. 验证 ----------
title "步骤 5/5：验证安装结果"
if VER="$("$PY" -c 'import icalendar; print(icalendar.__version__)' 2>&1)"; then
    ok "icalendar $VER 安装成功，已可被 Python 导入。"
    echo
    echo "    下一步：重启 TackList 服务后生效"
    echo "      cd \"$APP_DIR\" && ./tacklist.sh restart"
    echo "    若已启动，也可在设置 → 外部日历订阅 中直接点「立即同步」验证。"
    echo
    echo "    提示：若服务由其它用户或其它 Python 启动，请用同一个 python3 重新安装一次。"
    exit 0
else
    err "安装命令已返回成功，但 Python 仍无法导入 icalendar：$VER"
    echo "    常见原因：装到了其它 Python 环境（例如服务用 /usr/bin/python3，而安装用 venv）。"
    echo "    处理：用启动服务的那个 python3 重新运行本脚本；完整日志见 $LOG_FILE"
    log "ERROR: import failed: $VER"
    exit 1
fi
