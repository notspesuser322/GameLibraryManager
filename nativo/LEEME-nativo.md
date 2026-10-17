# La aplicación de Nébula (C#)

Esta carpeta tiene el programa que se abre al hacer doble clic en **`Nebula.exe`**:
una **aplicación de Windows nativa escrita en C#**, con toda la interfaz dibujada
con controles de Windows. **No hay página web, ni WebView2, ni navegador dentro.**

## Qué hace

1. Arranca el **motor** (`Nebula-nucleo.exe`, el que sabe de biblioteca, escaneos,
   fichas, carátulas y tiempo jugado) y espera a que responda.
2. Dibuja la aplicación:
   - **Biblioteca**: rejilla de carátulas, búsqueda y orden (A-Z, horas, última vez).
   - **Ficha de un juego**: datos, notas, estado y botones de jugar/detener/abrir carpeta.
   - **Buscar juegos**: carpetas vigiladas, análisis de una carpeta, alta de lo encontrado.
   - **Actividad** y **Estadísticas**: lo último jugado y los números de la biblioteca.
   - **Ajustes**: análisis y fichas automáticas, datos, registro y créditos a Playnite.
3. **Vigila al motor**: si la ventana se cierra, el motor se apaga con ella; si la
   ventana se cayera, el motor se da cuenta (se le pasa `--padre <pid>`) y se apaga
   solo. Si hay un juego en marcha, se sigue contando el tiempo hasta que acabe.
4. Atiende `--version`, `--help`, `--browser`, `--keep-alive` y pasa `--install` /
   `--uninstall` al motor, que es quien conoce el registro de Windows.

## Por qué así

- **Net Framework 4.8** (`net48`): ya viene con Windows, así que el usuario no
  tiene que instalar ningún runtime.
- **WinExe**: el ejecutable está marcado como programa de ventana, de modo que
  *nunca* aparece la ventana negra de consola.
- **El motor va aparte**: así la interfaz ya es nativa y el motor se puede ir
  pasando a C# por partes sin dejar de funcionar en ningún momento. La costura
  entre los dos es la API local (`/api/...`), la misma que usaba la interfaz web.
- **Sin WebView2 ni navegadores**: la ventana no depende de Edge ni de Chrome.

## Cómo se compila

No hace falta compilarlo a mano: `scripts/build-sea.mjs` lo compila solo cuando
detecta .NET y Windows, y después arma la carpeta:

```
dist/Nebula/            (lo que va dentro del ZIP portable)
  Nebula.exe            ← la aplicación (C#)
  Nebula-nucleo.exe     ← el motor
  Newtonsoft.Json.dll   ← para leer el JSON de la API
  LEEME.txt
  LEEME-tecnico.md
```

En el instalador, esta carpeta se incrusta dentro del propio
`Nebula-Instalador.exe` (recursos `ventana/`), y al instalar se copia tal cual a
`%LOCALAPPDATA%\Programs\Nebula`, con el motor al lado como `Nebula-nucleo.exe`.

Para compilarlo suelto, desde la raíz del repositorio:

```bat
dotnet build nativo/Nebula.Ventana/Nebula.Ventana.csproj -c Release -o dist/ventana -p:Version=1.5.0
```

Y para comprobar que el resultado no abre consola: el ejecutable tiene que llevar
la marca de subsistema «ventana» (2), no «consola» (3). Lo comprueba
`scripts/pe-subsystem.mjs` en cada compilación.

## Archivos

| Archivo | Qué contiene |
| --- | --- |
| `Program.cs` | arranque, argumentos, `--version`, `--help` y el reparto con el motor |
| `VentanaPrincipal.cs` | la ventana: barra lateral, cabecera, vistas y vigilancia |
| `VistaBiblioteca.cs` | la rejilla de carátulas, búsqueda y orden |
| `DialogoJuego.cs` | la ficha de un juego |
| `VistaBuscar.cs` | carpetas vigiladas y alta de juegos |
| `VistaActividad.cs`, `VistaEstadisticas.cs` | actividad y números |
| `VistaAjustes.cs` | ajustes y créditos |
| `Controles.cs` | la tarjeta de juego, el botón lateral y el panel redondeado |
| `Tema.cs` | colores, fuentes y ayudas de dibujo |
| `Api.cs` | cliente de la API del motor |
| `Modelos.cs` | juego, estado y carpeta vigilada |
| `Portadas.cs` | carátulas en memoria, compartidas por todas las vistas |
| `Nucleo.cs` | arrancar y vigilar el motor (con el citado de argumentos de Windows) |
| `Salida.cs` | registro en archivo y salida estándar cuando la hay |
