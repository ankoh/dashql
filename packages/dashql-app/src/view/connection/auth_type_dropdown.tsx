import * as React from 'react';
import * as proto from '@ankoh/dashql-protobuf';

import * as ActionList from '../foundations/action_list.js';

import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { Button, ButtonVariant } from '../foundations/button.js';
import { OverlaySize } from '../../view/foundations/overlay.js';
import { SymbolIcon } from '../../view/foundations/symbol_icon.js';

interface AuthTypeDrowndownProps {
    className?: string;
    selected: proto.dashql.auth.AuthType;
    onSelect: (t: proto.dashql.auth.AuthType) => void;
}

const AUTH_TYPE_NAMES = [
    "Basic Authentication",
    "OAuth 2.0"
];
function getAuthTypeName(t: proto.dashql.auth.AuthType) {
    return AUTH_TYPE_NAMES[t];
}

export function AuthTypeDropdown(props: AuthTypeDrowndownProps) {
    const [isOpen, setIsOpen] = React.useState<boolean>(false);

    // Construct the Button
    const TrinangleDownIcon = SymbolIcon("triangle_down_16");
    const AnchorButton = React.useMemo(() => {
        return (
            <Button
                className={props.className}
                onClick={() => setIsOpen(true)}
                trailingVisual={TrinangleDownIcon}
                variant={ButtonVariant.Default}
            >
                {getAuthTypeName(props.selected)}
            </Button>
        );
    }, [props.className, props.selected]);

    const ListItem = (itemProps: { auth: proto.dashql.auth.AuthType }) => {
        return (
            <ActionList.ListItem
                tabIndex={0}
                onClick={() => props.onSelect(itemProps.auth)}
                selected={props.selected == itemProps.auth}
            >
                <ActionList.ItemText>
                    <ActionList.ItemTextTitle>
                        {getAuthTypeName(itemProps.auth)}
                    </ActionList.ItemTextTitle>
                </ActionList.ItemText>
            </ActionList.ListItem>
        )
    };
    return (
        <AnchoredOverlay
            open={isOpen}
            onClose={() => setIsOpen(false)}
            renderAnchor={(p: object) => <div {...p}>{AnchorButton}</div>}
            focusZoneSettings={{ disabled: true }}
            width={OverlaySize.M}
        >
            <ActionList.List aria-label="Notebooks">
                <ActionList.GroupHeading>Authentication Types</ActionList.GroupHeading>
                <>
                    <ListItem key={0} auth={proto.dashql.auth.AuthType.AUTH_BASIC} />
                    <ListItem key={1} auth={proto.dashql.auth.AuthType.AUTH_OAUTH} />
                </>
            </ActionList.List>
        </AnchoredOverlay>
    );
}

