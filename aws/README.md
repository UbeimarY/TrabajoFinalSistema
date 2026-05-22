# AWS CLI v2

Este paquete contiene un ejecutable compilado de AWS CLI v2.

## Instalación

Para instalar AWS CLI v2, ejecuta el script `install`:

```bash
$ sudo ./install
Ahora puedes ejecutar: /usr/local/bin/aws --version
```

Esto instalará AWS CLI v2 en `/usr/local/bin/aws`. Suponiendo que
`/usr/local/bin` esté en tu variable `PATH`, ahora puedes ejecutar:

```bash
$ aws --version
```

### Instalación sin sudo

Si no tienes permisos de `sudo` o deseas instalar AWS
CLI v2 solo para el usuario actual, ejecuta el script `install` con las opciones `-b`
y `-i`:

```bash
$ ./install -i ~/.local/aws-cli -b ~/.local/bin
```

Esto instalará AWS CLI v2 en `~/.local/aws-cli` y creará
enlaces simbólicos para `aws` y `aws_completer` en `~/.local/bin`. Para más
información sobre estas opciones, ejecuta el script `install` con `-h`:

```bash
$ ./install -h
```

### Actualización

Si ejecutas el script `install` y ya existe una versión previamente instalada
de AWS CLI v2, el script mostrará un error. Para actualizar a la versión incluida
en este paquete, ejecuta el script `install` con `--update`:

```bash
$ sudo ./install --update
```

### Eliminar la instalación

Para eliminar AWS CLI v2, elimina la instalación y los enlaces simbólicos:

```bash
$ sudo rm -rf /usr/local/aws-cli
$ sudo rm /usr/local/bin/aws
$ sudo rm /usr/local/bin/aws_completer
```

Nota: si instalaste AWS CLI v2 usando las opciones `-b` o `-i`, también necesitarás
eliminar la instalación y los enlaces simbólicos en los directorios que especificaste.