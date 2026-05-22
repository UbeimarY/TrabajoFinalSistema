# ─────────────────────────────────────────────────────────────────────────────
# EC2 instances — one per Zero Trust zone.
#
# user_data:
#   Installs Python 3 so that Ansible can connect immediately after boot.
#   Also runs apt-get update so the first Ansible play is fast.
#   Uses cloud-init's write_files + runcmd to be idempotent across reboots.
# ─────────────────────────────────────────────────────────────────────────────

locals {
  bootstrap_user_data = base64encode(<<-CLOUDINIT
    #cloud-config
    package_update: true
    packages:
      - python3
      - python3-pip
    CLOUDINIT
  )
}

# ── vm-auth (private subnet) ──────────────────────────────────────────────────
resource "aws_instance" "auth" {
  ami                    = var.ami_id
  instance_type          = var.instance_types["auth"]
  subnet_id              = aws_subnet.private.id
  vpc_security_group_ids = [aws_security_group.auth.id]
  key_name               = aws_key_pair.main.key_name
  user_data_base64       = local.bootstrap_user_data

  root_block_device {
    volume_size           = var.root_volume_size_gb
    volume_type           = "gp3"
    delete_on_termination = true
  }

  tags = {
    Name    = "${var.project}-vm-auth"
    Role    = "auth"
    Project = var.project
  }
}

# ── vm-brokers (private subnet) ───────────────────────────────────────────────
resource "aws_instance" "brokers" {
  ami                    = var.ami_id
  instance_type          = var.instance_types["brokers"]
  subnet_id              = aws_subnet.private.id
  vpc_security_group_ids = [aws_security_group.brokers.id]
  key_name               = aws_key_pair.main.key_name
  user_data_base64       = local.bootstrap_user_data

  root_block_device {
    volume_size           = var.root_volume_size_gb
    volume_type           = "gp3"
    delete_on_termination = true
  }

  tags = {
    Name    = "${var.project}-vm-brokers"
    Role    = "brokers"
    Project = var.project
  }
}

# ── vm-api (PUBLIC subnet — the DMZ) ─────────────────────────────────────────
resource "aws_instance" "api" {
  ami                         = var.ami_id
  instance_type               = var.instance_types["api"]
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.api.id]
  key_name                    = aws_key_pair.main.key_name
  user_data_base64            = local.bootstrap_user_data
  associate_public_ip_address = true

  root_block_device {
    volume_size           = var.root_volume_size_gb
    volume_type           = "gp3"
    delete_on_termination = true
  }

  tags = {
    Name    = "${var.project}-vm-api"
    Role    = "api"
    Project = var.project
  }
}

# ── vm-init (private subnet) ──────────────────────────────────────────────────
resource "aws_instance" "init" {
  ami                    = var.ami_id
  instance_type          = var.instance_types["init"]
  subnet_id              = aws_subnet.private.id
  vpc_security_group_ids = [aws_security_group.init.id]
  key_name               = aws_key_pair.main.key_name
  user_data_base64       = local.bootstrap_user_data

  root_block_device {
    volume_size           = var.root_volume_size_gb
    volume_type           = "gp3"
    delete_on_termination = true
  }

  tags = {
    Name    = "${var.project}-vm-init"
    Role    = "init"
    Project = var.project
  }
}

# ── vm-core (private subnet) ──────────────────────────────────────────────────
resource "aws_instance" "core" {
  ami                    = var.ami_id
  instance_type          = var.instance_types["core"]
  subnet_id              = aws_subnet.private.id
  vpc_security_group_ids = [aws_security_group.core.id]
  key_name               = aws_key_pair.main.key_name
  user_data_base64       = local.bootstrap_user_data

  root_block_device {
    volume_size           = var.root_volume_size_gb
    volume_type           = "gp3"
    delete_on_termination = true
  }

  tags = {
    Name    = "${var.project}-vm-core"
    Role    = "core"
    Project = var.project
  }
}

# ── vm-app (private subnet) ───────────────────────────────────────────────────
resource "aws_instance" "app" {
  ami                    = var.ami_id
  instance_type          = var.instance_types["app"]
  subnet_id              = aws_subnet.private.id
  vpc_security_group_ids = [aws_security_group.app.id]
  key_name               = aws_key_pair.main.key_name
  user_data_base64       = local.bootstrap_user_data

  root_block_device {
    volume_size           = var.root_volume_size_gb
    volume_type           = "gp3"
    delete_on_termination = true
  }

  tags = {
    Name    = "${var.project}-vm-app"
    Role    = "app"
    Project = var.project
  }
}
