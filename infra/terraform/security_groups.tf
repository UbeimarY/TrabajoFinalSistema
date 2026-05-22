# ─────────────────────────────────────────────────────────────────────────────
# Security Groups — one per VM role.
#
# Design principle: these mirror the nftables rules (defence in depth).
# The nftables rules inside each VM are the authoritative Zero Trust boundary;
# the Security Groups are the AWS-layer safety net that stops traffic before
# it even reaches the OS.
#
# Egress: all SGs allow all outbound traffic (nftables handles fine-grained
# egress filtering inside the VM).
# ─────────────────────────────────────────────────────────────────────────────

locals {
  private_cidr = var.private_subnet_cidr
  public_cidr  = var.public_subnet_cidr
  all_internal = var.vpc_cidr # shorthand for "any VM in this VPC"
}

# ── sg-auth ───────────────────────────────────────────────────────────────────
# Accepts HTTPS (443) from every other VM in the VPC (they all need tokens).
# Accepts SSH only from the admin CIDR.
resource "aws_security_group" "auth" {
  name        = "${var.project}-sg-auth"
  description = "vm-auth: HTTPS from VPC + SSH from admin"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS token endpoint from any VM in VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [local.all_internal]
  }

  ingress {
    description = "SSH from admin"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  egress {
    description = "All outbound (nftables enforces fine-grained policy)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project}-sg-auth"
    Project = var.project
  }
}

# ── sg-brokers ────────────────────────────────────────────────────────────────
# Kafka 9092 and RabbitMQ 5672 from the private subnet only.
# Kafka controller port 9093 — internal only (same host, lo).
resource "aws_security_group" "brokers" {
  name        = "${var.project}-sg-brokers"
  description = "vm-brokers: Kafka+RabbitMQ from private subnet + SSH from admin"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "Kafka SASL_SSL from private subnet"
    from_port   = 9092
    to_port     = 9092
    protocol    = "tcp"
    cidr_blocks = [local.private_cidr, local.public_cidr]
  }

  ingress {
    description = "RabbitMQ AMQPS from private subnet"
    from_port   = 5672
    to_port     = 5672
    protocol    = "tcp"
    cidr_blocks = [local.private_cidr, local.public_cidr]
  }

  ingress {
    description = "SSH from admin"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project}-sg-brokers"
    Project = var.project
  }
}

# ── sg-api ────────────────────────────────────────────────────────────────────
# HTTPS (443) open to the Internet (this is the DMZ).
# SSH from admin only.
resource "aws_security_group" "api" {
  name        = "${var.project}-sg-api"
  description = "vm-api: HTTPS from Internet + SSH from admin"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS voting API - public"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP redirect (optional, useful for healthchecks)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH from admin"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project}-sg-api"
    Project = var.project
  }
}

# ── sg-init ───────────────────────────────────────────────────────────────────
# No inbound traffic needed (one-shot task VM).
# SSH from admin for troubleshooting.
resource "aws_security_group" "init" {
  name        = "${var.project}-sg-init"
  description = "vm-init: SSH from admin only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "SSH from admin"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project}-sg-init"
    Project = var.project
  }
}

# ── sg-core ───────────────────────────────────────────────────────────────────
# No inbound from outside VPC. SSH from admin.
resource "aws_security_group" "core" {
  name        = "${var.project}-sg-core"
  description = "vm-core: SSH from admin only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "SSH from admin"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project}-sg-core"
    Project = var.project
  }
}

# ── sg-app ────────────────────────────────────────────────────────────────────
# Dashboard HTTP ports open only within the VPC (not to Internet).
# SSH from admin.
resource "aws_security_group" "app" {
  name        = "${var.project}-sg-app"
  description = "vm-app: dashboard ports within VPC + SSH from admin"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "Global dashboard (port 3000) from VPC"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = [local.all_internal]
  }

  ingress {
    description = "Regional dashboard (port 3001) from VPC"
    from_port   = 3001
    to_port     = 3001
    protocol    = "tcp"
    cidr_blocks = [local.all_internal]
  }

  ingress {
    description = "SSH from admin"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project}-sg-app"
    Project = var.project
  }
}

# Regla adicional: SSH desde la VPC para el bastión (Ansible ProxyJump)
resource "aws_security_group_rule" "ssh_from_vpc_auth" {
  type              = "ingress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = ["10.10.0.0/16"]
  security_group_id = aws_security_group.auth.id
}

resource "aws_security_group_rule" "ssh_from_vpc_brokers" {
  type              = "ingress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = ["10.10.0.0/16"]
  security_group_id = aws_security_group.brokers.id
}

resource "aws_security_group_rule" "ssh_from_vpc_init" {
  type              = "ingress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = ["10.10.0.0/16"]
  security_group_id = aws_security_group.init.id
}

resource "aws_security_group_rule" "ssh_from_vpc_core" {
  type              = "ingress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = ["10.10.0.0/16"]
  security_group_id = aws_security_group.core.id
}

resource "aws_security_group_rule" "ssh_from_vpc_app" {
  type              = "ingress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = ["10.10.0.0/16"]
  security_group_id = aws_security_group.app.id
}
