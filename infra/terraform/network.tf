# ── VPC ───────────────────────────────────────────────────────────────────────
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name    = "${var.project}-vpc"
    Project = var.project
  }
}

# ── Subnets ───────────────────────────────────────────────────────────────────

# Public subnet — only vm-api lives here (needs a public IP)
resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidr
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true

  tags = {
    Name    = "${var.project}-public"
    Project = var.project
  }
}

# Private subnet — all other VMs
resource "aws_subnet" "private" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_cidr
  availability_zone = data.aws_availability_zones.available.names[0]

  tags = {
    Name    = "${var.project}-private"
    Project = var.project
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

# ── Internet Gateway (public subnet egress) ───────────────────────────────────
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name    = "${var.project}-igw"
    Project = var.project
  }
}

# ── Elastic IP + NAT Gateway (private subnet egress for apt/docker pulls) ────
resource "aws_eip" "nat" {
  domain = "vpc"

  tags = {
    Name    = "${var.project}-nat-eip"
    Project = var.project
  }
}

resource "aws_nat_gateway" "nat" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public.id # NAT GW must sit in the public subnet

  tags = {
    Name    = "${var.project}-nat"
    Project = var.project
  }

  depends_on = [aws_internet_gateway.igw]
}

# ── Route tables ──────────────────────────────────────────────────────────────

# Public route table — default route via IGW
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }

  tags = {
    Name    = "${var.project}-rt-public"
    Project = var.project
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# Private route table — default route via NAT GW
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.nat.id
  }

  tags = {
    Name    = "${var.project}-rt-private"
    Project = var.project
  }
}

resource "aws_route_table_association" "private" {
  subnet_id      = aws_subnet.private.id
  route_table_id = aws_route_table.private.id
}
