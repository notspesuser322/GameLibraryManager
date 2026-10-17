# La ventana nativa de Nébula (C#)

Esta carpeta tiene el programa que se abre al hacer doble clic en **`Nebula.exe`**:
una ventana de Windows de verdad, escrita en C#, que:

1. arranca el **núcleo** (`Nebula-nucleo.exe`, el motor Node con toda la lógica:
   escaneos, fichas, carátulas, biblioteca);
2. espera a que responda y dibuja la interfaz dentro de la ventana con
   **WebView2** (el motor de dibujo que ya trae Microsoft Edge en Windows 10/11);
3. **vigila** al núcleo: si la ventana se cierra, el núcleo se apaga con ella; si
   la ventana se cae, el núcleo lo detecta y se apaga solo (nada queda corriendo
   por detrás);
4. atiende `--version`, `--help`, `--browser`, `--keep-alive` y pasa `--install` /
   `--uninstall` al núcleo, que es quien conoce el registro de Windows.

## Por qué así

- **Net Framework 4.8** (`net48`): ya viene con Windows, así que el usuario no
  tiene que instalar ningún runtime. El programa pesa menos de un megabyte.
- **WinExe**: el ejecutable está marcado como programa de ventana, de modo que
  *nunca* aparece la ventana negra de consola — ni al abrirlo ni al pasarle
  órdenes desde una terminal.
- **El motor va aparte**: reescribir en C# toda la biblioteca (escaneo de
  carpetas, metadatos, estadísticas, medición de tiempo) sería empezar de cero.
  Así la ventana es nativa ya y el motor se puede ir pasando a C# por partes, sin
  dejar de funcionar en ningún momento.
- **Si no hay WebView2** (equipo sin Edge, por ejemplo), la ventana delega en el
  núcleo y la biblioteca se abre como antes: el programa nunca se queda sin
  interfaz.

## Cómo se compila

No hace falta compilarlo a mano: `scripts/build-sea.mjs` lo compila solo cuando
detecta .NET y Windows, y después arma la carpeta:

```
dist/Nebula/            (lo que va dentro del ZIP portable)
  Nebula.exe            ← esta ventana nativa
  Nebula-nucleo.exe     ← el motor
  LEEME.txt
  LEEME-tecnico.md
```

En el instalador, esta carpeta se incrusta dentro del propio
`Nebula-Instalador.exe` (recursos `ventana/`), y al instalar se copia tal cual a
`%LOCALAPPDATA%\Programs\Nebula`, con el núcleo al lado como `Nebula-nucleo.exe`.

Para compilarlo suelto, desde la raíz del repositorio:

```bat
dotnet build nativo/Nebula.Ventana/Nebula.Ventana.csproj -c Release -o dist/ventana -p:Version=1.4.0
```

Y para comprobar que el resultado no abre consola (la comprobación que hace la
integración continua por su cuenta): el ejecutable tiene que llevar la marca de
subsistema «ventana» (2), no «consola» (3). Lo comprueba
`scripts/pe-subsystem.mjs`.
