# -*- coding: utf-8 -*-
"""
Instalador grafico del POS EXPENDIO BB (Windows 8.1 / 10 x64, 100% offline).

Secuencia reproducida desde NOTAS_DESPLIEGUE.md (despliegue validado en VM):
  1. VC++ Redistributable (UCRT) si falta api-ms-win-crt-*
  2. Python 3.9.13 si no hay un 3.9 compatible instalado
  3. Extrae el repositorio (pos-expendio-bb.zip) en C:\\POS\\pos-expendio-bb
  4. Crea venv e instala dependencias OFFLINE desde wheels/
  5. Firefox 115 ESR (navegador moderno; IE11 no soporta el login)
  6. Auto-logon opcional (HKLM Winlogon)
  7. Tarea ONLOGON "POS Expendio BB" -> iniciar_silencioso.bat
  8. Verificacion: arranca el servidor, health + login -> 200

Compilar a un unico .exe con PyInstaller (ver build_exe.bat):
  pyinstaller --onefile --noconsole --add-data "assets;assets" installer.py
"""

import ctypes
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import tkinter as tk
import urllib.request
import zipfile
from tkinter import messagebox, ttk

APP_TITLE = "Instalador POS EXPENDIO BB"
DEFAULT_DEST = r"C:\POS\pos-expendio-bb"
TASK_NAME = "POS Expendio BB"
URL_ITEM = "http://127.0.0.1:5000"

if getattr(sys, "frozen", False):
    ASSETS_DIR = os.path.join(sys._MEIPASS, "assets")
else:
    ASSETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")


def asset(name):
    return os.path.join(ASSETS_DIR, name)


# ---------------------------------------------------------------------------
# Utilidades de sistema
# ---------------------------------------------------------------------------
def is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def relaunch_elevated():
    """Re-lanza la app con UAC (elevacion interactiva, como se hizo en la VM)."""
    script = os.path.abspath(sys.argv[0] or __file__)
    cmd = (
        'powershell -NoProfile -Command "Start-Process -FilePath '
        "'{}' -ArgumentList '{}' -Verb RunAs -Wait\"".format(
            sys.executable, script
        )
    )
    subprocess.Popen(cmd, shell=True)
    sys.exit(0)


def run(cmd, timeout=None, cwd=None):
    """Ejecuta un comando y devuelve (exit_code, stdout)."""
    si = None
    try:
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    except Exception:
        si = None
    try:
        popen_kwargs = {}
        if si is not None:
            popen_kwargs["startupinfo"] = si
        p = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            cwd=cwd,
            shell=True,
            **popen_kwargs,
        )
        out, _ = p.communicate(timeout=timeout)
        return p.returncode, (out or b"").decode("utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        try:
            p.kill()
        except Exception:
            pass
        return -1, "Tiempo agotado"
    except Exception as e:
        return -1, str(e)


def find_python():
    """Busca un python.exe 3.9 compatible instalado en rutas conocidas."""
    candidates = [
        os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Python39", "python.exe"),
        os.path.join(
            os.environ.get("LOCALAPPDATA", r"C:\Users\Public"),
            "Programs", "Python", "Python39", "python.exe",
        ),
        r"C:\Python39\python.exe",
    ]
    seen = set()
    for c in candidates:
        if c in seen:
            continue
        seen.add(c)
        if os.path.exists(c):
            rc, out = run('"{}" --version'.format(c))
            if rc == 0 and "Python 3.9" in out:
                return c
    rc, out = run("where python")
    if rc == 0:
        for line in out.splitlines():
            line = line.strip().strip('"')
            if not line or not os.path.exists(line):
                continue
            rc2, out2 = run('"{}" --version'.format(line))
            if rc2 == 0 and "Python 3.9" in out2:
                return line
    return None


def ucrt_present():
    return os.path.exists(
        os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32",
                     "api-ms-win-crt-runtime-l1-1-0.dll")
    )


def find_firefox():
    paths = [
        r"C:\Program Files\Mozilla Firefox\firefox.exe",
        r"C:\Program Files (x86)\Mozilla Firefox\firefox.exe",
    ]
    return next((p for p in paths if os.path.exists(p)), None)


# ---------------------------------------------------------------------------
# Pasos de instalacion (cada uno: (ctx) -> (ok, mensaje))
# ---------------------------------------------------------------------------
class Installer:
    def __init__(self, dest, auto_logon, user, domain, pwd, use_firefox):
        self.dest = dest
        self.auto_logon = auto_logon
        self.logon_user = user
        self.logon_domain = domain
        self.logon_pwd = pwd
        self.use_firefox = use_firefox
        # El zip trae raiz "pos-expendio-bb/"; se extrae sin el prefijo,
        # por lo que el proyecto queda directamente en dest.
        self.project = dest

    # --- 1. VC++ / UCRT ----------------------------------------------------
    def step_ucrt(self):
        if ucrt_present():
            return True, "UCRT presente, se omite."
        cfg = asset("vc_redist.x64.exe")
        if not os.path.exists(cfg):
            return False, "No se encontro vc_redist.x64.exe en assets."
        rc, out = run('"{}" /install /quiet /norestart'.format(cfg), timeout=900)
        if rc != 0:
            return False, "vc_redist fallo ({})".format(rc)
        for _ in range(30):
            if ucrt_present():
                return True, "VC++ Redistributable instalado (UCRT OK)."
            time.sleep(2)
        return False, "UCRT no detectada tras instalar VC++."

    # --- 2. Python ----------------------------------------------------------
    def step_python(self):
        if find_python():
            return True, "Python 3.9 encontrado, se omite."
        cfg = asset("python-3.9.13-amd64.exe")
        if not os.path.exists(cfg):
            return False, "No se encontro el instalador de Python en assets."
        rc, out = run(
            '"{}" /quiet InstallAllUsers=1 InstallDir=C:\\Python39 '
            'PrependPath=1 Include_test=0 Shortcuts=0'.format(cfg),
            timeout=1800,
        )
        if rc != 0:
            return False, "Instalacion de Python fallo ({})".format(rc)
        for _ in range(60):
            py = find_python()
            if py:
                return True, "Python 3.9.13 instalado en {}".format(py)
            time.sleep(3)
        return False, "No se detecto Python tras la instalacion."

    # --- 3. Repositorio -----------------------------------------------------
    def step_repo(self):
        z = asset("pos-expendio-bb.zip")
        if not os.path.exists(z):
            return False, "No se encontro pos-expendio-bb.zip en assets."
        os.makedirs(self.dest, exist_ok=True)
        marker = os.path.join(self.project, "server", "app.py")
        if os.path.exists(marker):
            return True, "Repositorio ya presente en {}.".format(self.project)
        try:
            # Extrae quitando la raiz "pos-expendio-bb/" del zip para que
            # quede directamente en self.project (evita doble anidamiento).
            prefix = "pos-expendio-bb/"
            with zipfile.ZipFile(z) as zf:
                for info in zf.infolist():
                    name = info.filename
                    if name == prefix or name.startswith(prefix):
                        rel = name[len(prefix):]
                        if not rel:
                            continue
                        target = os.path.join(self.dest, rel)
                        if info.is_dir():
                            os.makedirs(target, exist_ok=True)
                        else:
                            os.makedirs(os.path.dirname(target), exist_ok=True)
                            with zf.open(info) as src, open(target, "wb") as dst:
                                shutil.copyfileobj(src, dst)
        except Exception as e:
            return False, "Error extrayendo el repositorio: {}".format(e)
        if os.path.exists(marker):
            return True, "Repositorio extraido en {}.".format(self.project)
        return False, "La extraccion no produjo la estructura esperada."

    # --- 4. venv + dependencias offline --------------------------------------
    def step_venv(self):
        py = find_python()
        if not py:
            return False, "No se encontro Python para crear el venv."
        venv_py = os.path.join(self.project, "venv", "Scripts", "python.exe")
        # Si el venv existe pero flask no importa, se reconstruye.
        if os.path.exists(venv_py):
            rc, out = run('"{}" -c "import flask"'.format(venv_py))
            if rc == 0:
                return True, "venv ya existe y funciona, se reutiliza."
            shutil.rmtree(os.path.join(self.project, "venv"), ignore_errors=True)
        rc, out = run('"{}" -m venv "{}"'.format(py, os.path.join(self.project, "venv")), timeout=600)
        if rc != 0:
            return False, "Fallo al crear el venv."
        wheels = os.path.join(ASSETS_DIR, "wheels")
        req = os.path.join(self.project, "server", "requirements.txt")
        rc, out = run(
            '"{}" -m pip install --no-index --find-links "{}" -r "{}"'.format(
                venv_py, wheels, req
            ),
            timeout=1800,
        )
        if rc != 0:
            return False, "Fallo la instalacion de dependencias offline: {}".format(out[-500:])
        rc, out = run('"{}" -c "import flask, openpyxl, waitress"'.format(venv_py))
        if rc != 0:
            return False, "El venv quedo sin dependencias: {}".format(out[-300:])
        return True, "venv y dependencias instaladas (offline)."

    # --- 5. Firefox -----------------------------------------------------------
    def step_firefox(self):
        if not self.use_firefox:
            return True, "Firefox omitido por configuracion."
        if find_firefox():
            return True, "Firefox ya instalado, se omite."
        cfg = asset("firefox_setup.exe")
        if not os.path.exists(cfg):
            return False, "No se encontro firefox_setup.exe en assets."
        rc, out = run('"{}" /S'.format(cfg), timeout=900)
        if rc != 0:
            return False, "Instalacion de Firefox fallo ({})".format(rc)
        for _ in range(30):
            if find_firefox():
                return True, "Firefox 115 ESR instalado."
            time.sleep(2)
        return False, "No se detecto Firefox tras instalar."

    # --- 6. Auto-logon ---------------------------------------------------------
    def step_autologon(self):
        if not self.auto_logon:
            return True, "Auto-logon omitido."
        if not self.logon_user:
            return False, "Para auto-logon se requiere el usuario de Windows."
        base = r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
        vals = [
            ("AutoAdminLogon", "1"),
            ("DefaultUserName", self.logon_user),
            ("DefaultDomainName", self.logon_domain or "."),
            ("DefaultPassword", self.logon_pwd or ""),
        ]
        for name, value in vals:
            rc, out = run(
                'reg add "{}" /v {} /t REG_SZ /d "{}" /f'.format(base, name, value)
            )
            if rc != 0:
                return False, "reg add {} fallo ({}).".format(name, rc)
        return True, "Auto-logon configurado para {}.".format(self.logon_user)

    # --- 7. Tarea ONLOGON -------------------------------------------------------
    def step_task(self):
        venv_py = os.path.join(self.project, "venv", "Scripts", "python.exe")
        app_path = os.path.join(self.project, "server", "app.py")
        logs_dir = os.path.join(self.dest, "pos", "logs")
        os.makedirs(logs_dir, exist_ok=True)
        launcher = os.path.join(self.dest, "iniciar_silencioso.bat")
        server_dir = os.path.join(self.project, "server")
        firefox = find_firefox() or r"C:\Program Files\Mozilla Firefox\firefox.exe"
        ff = '"{}" http://127.0.0.1:5000'.format(firefox)

        bat = (
            "@echo off\r\n"
            "cd /d {}\r\n"
            "set PORT=5000\r\n"
            'start /b cmd /c "ping -n 4 127.0.0.1 >nul & {}"\r\n'
            '"{}" app.py >> "{}" 2>&1\r\n'
        ).format(server_dir, ff, venv_py, os.path.join(logs_dir, "servidor.log"))
        with open(launcher, "w", encoding="utf-8") as f:
            f.write(bat)

        # Elimina y recrea la tarea (asesinar la previa)
        run('schtasks /End /TN "{}" >nul 2>&1'.format(TASK_NAME))
        run('schtasks /Delete /TN "{}" /F >nul 2>&1'.format(TASK_NAME))
        rc, out = run(
            'schtasks /Create /TN "{}" /TR "{}" /SC ONLOGON /RL LIMITED /F'.format(
                TASK_NAME, launcher
            )
        )
        if rc != 0:
            return False, "schtasks ONLOGON fallo ({}). Requiere elevacion.".format(rc)
        return True, "Tarea '{}' registrada.".format(TASK_NAME)

    # --- 8. Verificacion ---------------------------------------------------------
    def step_verify(self):
        venv_py = os.path.join(self.project, "venv", "Scripts", "python.exe")
        app_path = os.path.join(self.project, "server", "app.py")
        logs_dir = os.path.join(self.dest, "pos", "logs")
        os.makedirs(logs_dir, exist_ok=True)
        log = os.path.join(logs_dir, "servidor.log")

        # Asegura: secret JWT -> pos/.jwt_secret (el app lo genera si no existe)
        with open(log, "a", encoding="utf-8") as f:
            f.write("[installer] iniciando servidor para verificacion\n")
        log_handle = open(log, "a", encoding="utf-8", errors="replace")
        proc = subprocess.Popen(
            [venv_py, app_path],
            cwd=os.path.join(self.project, "server"),
            shell=False,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
        )
        try:
            health = None
            for _ in range(40):
                time.sleep(1)
                try:
                    with urllib.request.urlopen(URL_ITEM + "/api/health", timeout=2) as r:
                        if r.status == 200:
                            health = json.loads(r.read().decode())
                            break
                except Exception:
                    continue
            if health is None:
                return False, "El servidor no respondio /api/health."
            login = urllib.request.Request(
                URL_ITEM + "/api/auth/login",
                data=json.dumps({"username": "admin", "password": "admin123"}).encode(),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(login, timeout=5) as r:
                if r.status != 200:
                    return False, "Login devolvio HTTP {}.".format(r.status)
                body = json.loads(r.read().decode())
                if "token" not in body:
                    return False, "Login no devolvio token."
            return True, (
                "Servidor OK: health 200 y login admin/admin123 OK."
            )
        finally:
            try:
                log_handle.close()
            except Exception:
                pass
            try:
                run('taskkill /PID {} /T /F >nul 2>&1'.format(proc.pid))
            except Exception:
                pass
            try:
                proc.terminate()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# GUI
# ---------------------------------------------------------------------------
class App:
    def __init__(self, root):
        self.root = root
        self.q = queue.Queue()
        self.running = False
        root.title(APP_TITLE)
        root.geometry("760x620")
        root.minsize(680, 540)

        pad = {"padx": 16, "pady": 6}
        desc = (
            "Instalacion automatica 100% offline (USB) del sistema de Punto de "
            "Venta.\nSe reproducen los pasos validados: UCRT, Python 3.9, repo, "
            "dependencias, Firefox, auto-logon y arranque automatico."
        )
        tk.Label(root, text=APP_TITLE, font=("Segoe UI", 16, "bold")).pack(anchor="w", **pad)
        tk.Label(root, text=desc, justify="left", wraplength=700, fg="#444").pack(anchor="w", **pad)

        cfg = tk.LabelFrame(root, text=" Configuracion ", font=("Segoe UI", 10, "bold"))
        cfg.pack(fill="x", **pad)

        row = tk.Frame(cfg)
        row.pack(fill="x", padx=10, pady=4)
        tk.Label(row, text="Carpeta destino:", width=18, anchor="w").pack(side="left")
        self.var_dest = tk.StringVar(value=DEFAULT_DEST)
        tk.Entry(row, textvariable=self.var_dest, width=52).pack(side="left")

        row = tk.Frame(cfg)
        row.pack(fill="x", padx=10, pady=4)
        self.var_firefox = tk.BooleanVar(value=True)
        tk.Checkbutton(
            row, text="Instalar Firefox 115 ESR (necesario: IE11 no soporta el login)",
            variable=self.var_firefox,
        ).pack(side="left")

        row = tk.Frame(cfg)
        row.pack(fill="x", padx=10, pady=4)
        self.var_autologon = tk.BooleanVar(value=False)
        tk.Checkbutton(
            row, text="Configurar auto-logon (arranca solo al encender):",
            variable=self.var_autologon, command=self._toggle_autologon,
        ).pack(side="left")

        self.autologon_frame = tk.Frame(cfg)
        self.autologon_frame.pack(fill="x", padx=10, pady=2)
        sub = tk.Frame(self.autologon_frame)
        sub.pack(fill="x", pady=2)
        for lbl, key in (("Usuario:", "user"), ("Dominio:", "domain"), ("Contraseña:", "pwd")):
            tk.Label(sub, text=lbl, width=12, anchor="w").pack(side="left", padx=(0, 4))
        self.var_user = tk.StringVar()
        self.var_domain = tk.StringVar(value=".")
        self.var_pwd = tk.StringVar()
        tk.Entry(sub, textvariable=self.var_user, width=14).pack(side="left", padx=4)
        tk.Entry(sub, textvariable=self.var_domain, width=10).pack(side="left", padx=4)
        tk.Entry(sub, textvariable=self.var_pwd, width=14, show="*").pack(side="left", padx=4)
        self._toggle_autologon()

        btn = tk.Frame(root)
        btn.pack(fill="x", **pad)
        self.btn_run = tk.Button(
            btn, text="▶ Iniciar instalacion", font=("Segoe UI", 11, "bold"),
            bg="#2563eb", fg="white", command=self.start,
        )
        self.btn_run.pack(side="left")
        self.btn_quit = tk.Button(btn, text="Salir", command=root.destroy)
        self.btn_quit.pack(side="right")

        tk.Label(root, text="Progreso:", anchor="w").pack(fill="x", **pad)
        self.progress = ttk.Progressbar(root, maximum=8, mode="determinate")
        self.progress.pack(fill="x", **pad)

        self.log = tk.Text(root, height=16, state="disabled", font=("Consolas", 9))
        self.log.pack(fill="both", expand=True, padx=16, pady=(0, 16))

        self.log_internal("Instalador listo. Verifica la configuracion y pulsa Iniciar.")
        self._drain_queue()

    def _toggle_autologon(self):
        state = "normal" if self.var_autologon.get() else "disabled"
        for child in self.autologon_frame.winfo_children():
            for c in child.winfo_children():
                try:
                    c.configure(state=state)
                except Exception:
                    pass

    # --- log & progreso -----------------------------------------------------
    def log_internal(self, msg):
        self.log.configure(state="normal")
        self.log.insert("end", msg + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def set_progress(self, step, total=8):
        self.progress["value"] = step

    def _drain_queue(self):
        try:
            while True:
                kind, payload = self.q.get_nowait()
                if kind == "log":
                    self.log_internal(payload)
                elif kind == "progress":
                    self.set_progress(payload)
                elif kind == "done":
                    self.finish(payload)
        except queue.Empty:
            pass
        self.root.after(120, self._drain_queue)

    # --- flujo ---------------------------------------------------------------
    def start(self):
        if self.running:
            return
        dest = self.var_dest.get().strip()
        if not dest:
            messagebox.showerror(APP_TITLE, "Indica una carpeta destino.")
            return
        if " " in dest:
            messagebox.showerror(
                APP_TITLE,
                "La carpeta destino no debe contener espacios "
                "(se usa en start_pos.bat y la tarea ONLOGON).\n"
                "Usa por ejemplo: C:\\POS\\pos-expendio-bb",
            )
            return
        if self.var_autologon.get() and not self.var_user.get().strip():
            messagebox.showerror(APP_TITLE, "Para auto-logon escribe el usuario de Windows.")
            return

        if not is_admin():
            messagebox.showinfo(
                APP_TITLE,
                "El instalador necesita permisos de administrador.\n"
                "Se relanzara con el dialogo de UAC (haz clic en 'Si').",
            )
            relaunch_elevated()
            return

        self.running = True
        self.btn_run.config(state="disabled")
        self.inst = Installer(
            dest=dest,
            auto_logon=self.var_autologon.get(),
            user=self.var_user.get().strip(),
            domain=self.var_domain.get().strip(),
            pwd=self.var_pwd.get(),
            use_firefox=self.var_firefox.get(),
        )
        threading.Thread(target=self._worker, daemon=True).start()

    def _worker(self):
        steps = [
            ("Comprobando UCRT / VC++ Redistributable...", self.inst.step_ucrt),
            ("Comprobando Python 3.9...", self.inst.step_python),
            ("Extrayendo aplicacion...", self.inst.step_repo),
            ("Creando venv e instalando dependencias (offline)...", self.inst.step_venv),
            ("Comprobando Firefox...", self.inst.step_firefox),
            ("Configurando auto-logon...", self.inst.step_autologon),
            ("Registrando arranque automatico (ONLOGON)...", self.inst.step_task),
            ("Verificando servidor (health + login)...", self.inst.step_verify),
        ]
        ok_all = True
        for i, (label, fn) in enumerate(steps, start=1):
            self.q.put(("progress", i - 1))
            self.q.put(("log", "\n[{}/{}] {}".format(i, len(steps), label)))
            try:
                ok, msg = fn()
            except Exception as e:
                ok, msg = False, "Excepcion: {}".format(e)
            self.q.put(("log", "    -> {}".format(msg)))
            self.q.put(("progress", i))
            if not ok:
                ok_all = False
                self.q.put(("log", "    !! PASO FALLIDO: {}".format(msg)))
                break
        self.q.put(("done", ok_all))

    def finish(self, ok_all):
        self.running = False
        self.btn_run.config(state="normal")
        if ok_all:
            messagebox.showinfo(
                APP_TITLE,
                "Instalacion completada correctamente.\n\n"
                "El sistema quedara disponible en:\n"
                "  http://127.0.0.1:5000\n\n"
                "Al reiniciar la PC se arranca solo (arranque automatico).",
            )
        else:
            messagebox.showerror(
                APP_TITLE,
                "La instalacion no termino. Revisa el registro de arriba y "
                "consulta NOTAS_DESPLIEGUE.md para las soluciones conocidas.",
            )


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()